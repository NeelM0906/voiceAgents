import { Hono } from 'hono';
import { z } from 'zod';
import {
  bumpConversationLastMessageAt,
  getConversation,
  getOrCreateConversationByContact,
  listConversationsForTenant,
} from '../db/conversations.js';
import { insertMessage, listMessagesByConversation } from '../db/messages.js';
import { getTenantBySlugOrId } from '../db/tenants.js';
import { sendSms } from '../twilio/client.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { handleAdminRouteError, parseJsonBody } from './admin-utils.js';

const e164Schema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{1,14}$/, 'must be E.164, for example +15551234567');

const sendTestSmsSchema = z.object({
  to: e164Schema,
  body: z.string().trim().min(1).max(1000),
});

export const conversationRoutes = new Hono();

conversationRoutes.get('/:slugOrId/conversations', async (c) => {
  const limit = parseLimit(c.req.query('limit'), 50, 100);

  if (!limit.ok) {
    return c.json({ error: 'invalid_request', message: limit.message }, 400);
  }

  const contactPhoneParam = c.req.query('contact_phone');
  let contactPhone: string | undefined;

  if (contactPhoneParam) {
    const normalizedContactPhone = normalizePhoneE164(contactPhoneParam);

    if (!normalizedContactPhone) {
      return c.json({ error: 'invalid_request', message: 'contact_phone must be E.164' }, 400);
    }

    contactPhone = normalizedContactPhone;
  }

  try {
    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    const conversations = await listConversationsForTenant({
      tenantId: details.tenant.id,
      contactPhone,
      limit: limit.value,
      beforeCursor: c.req.query('before_cursor'),
    });

    return c.json({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        contact_phone: conversation.contact_phone,
        last_message_at: conversation.last_message_at,
        message_count: conversation.message_count,
      })),
    });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

conversationRoutes.get('/:slugOrId/conversations/:conversationId', async (c) => {
  const limit = parseLimit(c.req.query('limit'), 50, 100);

  if (!limit.ok) {
    return c.json({ error: 'invalid_request', message: limit.message }, 400);
  }

  try {
    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    const conversation = await getConversation({
      tenantId: details.tenant.id,
      conversationId: c.req.param('conversationId'),
    });

    if (!conversation) {
      return c.json({ error: 'not_found' }, 404);
    }

    const page = await listMessagesByConversation({
      tenantId: details.tenant.id,
      conversationId: conversation.id,
      limit: limit.value,
      beforeCursor: c.req.query('before_cursor'),
    });

    return c.json({
      conversation: {
        id: conversation.id,
        contact_phone: conversation.contact_phone,
        last_message_at: conversation.last_message_at,
        created_at: conversation.created_at,
      },
      messages: page.messages.map((message) => ({
        id: message.id,
        channel: message.channel,
        role: message.role,
        content: message.content,
        call_id: message.call_id,
        created_at: message.created_at,
        metadata: message.metadata,
      })),
      next_cursor: page.nextCursor,
    });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

conversationRoutes.post('/:slugOrId/send-test-sms', async (c) => {
  const parsed = await parseJsonBody(c, sendTestSmsSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    const from = details.phone_numbers[0];

    if (!from) {
      return c.json({ error: 'not_found', message: 'tenant has no registered phone numbers' }, 404);
    }

    const conversation = await getOrCreateConversationByContact({
      tenantId: details.tenant.id,
      contactPhone: parsed.data.to,
    });

    const outbound = await sendSms({
      from,
      to: parsed.data.to,
      body: parsed.data.body,
    });

    const message = await insertMessage({
      conversationId: conversation.id,
      tenantId: details.tenant.id,
      channel: 'sms',
      role: 'assistant',
      content: parsed.data.body,
      externalId: outbound.sid,
      metadata: {
        source: 'admin-test-sms',
        twilioMessageSid: outbound.sid,
      },
    });

    await bumpConversationLastMessageAt({
      tenantId: details.tenant.id,
      conversationId: conversation.id,
      lastMessageAt: message.created_at,
    });

    return c.json(
      {
        messageSid: outbound.sid,
        persisted_message_id: message.id,
      },
      201,
    );
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

type LimitResult =
  | {
      ok: true;
      value: number;
    }
  | {
      ok: false;
      message: string;
    };

function parseLimit(value: string | undefined, defaultValue: number, maxValue: number): LimitResult {
  if (value === undefined) {
    return {
      ok: true,
      value: defaultValue,
    };
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxValue) {
    return {
      ok: false,
      message: `limit must be an integer from 1 to ${maxValue}`,
    };
  }

  return {
    ok: true,
    value: parsed,
  };
}
