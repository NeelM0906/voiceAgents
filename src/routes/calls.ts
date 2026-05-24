import { AgentDispatchClient, RoomServiceClient, SipClient } from 'livekit-server-sdk';
import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.js';
import { insertCall, updateCallEnded } from '../db/calls.js';
import { getOrCreateConversationByContact } from '../db/conversations.js';
import { getTenantBySlugOrId } from '../db/tenants.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { handleAdminRouteError, parseJsonBody } from './admin-utils.js';

const outboundCallSchema = z.object({
  to: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{1,14}$/, 'must be E.164, for example +15551234567'),
  from: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{1,14}$/, 'must be E.164, for example +15551234567')
    .optional(),
  first_message: z.string().trim().min(1).max(500).optional(),
  wait_until_answered: z.boolean().default(false),
  ringing_timeout_seconds: z.number().int().min(5).max(120).default(45),
  max_call_duration_seconds: z.number().int().min(60).max(7200).default(1800),
});

export const callRoutes = new Hono();

callRoutes.post('/:slugOrId/calls/outbound', async (c) => {
  const parsed = await parseJsonBody(c, outboundCallSchema);
  let insertedCallId: string | null = null;

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
      return c.json({ error: 'livekit_not_configured' }, 400);
    }

    if (!config.LIVEKIT_SIP_OUTBOUND_TRUNK_ID) {
      return c.json({ error: 'outbound_trunk_not_configured' }, 400);
    }

    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    if (details.tenant.status !== 'active') {
      return c.json({ error: 'tenant_not_active' }, 409);
    }

    const to = normalizePhoneE164(parsed.data.to);
    const from = normalizePhoneE164(parsed.data.from ?? details.phone_numbers[0]);

    if (!to || !from) {
      return c.json({ error: 'invalid_phone_number' }, 400);
    }

    const roomName = outboundRoomName(details.tenant.slug);
    const conversation = await getOrCreateConversationByContact({
      tenantId: details.tenant.id,
      contactPhone: to,
    });
    const call = await insertCall({
      tenant_id: details.tenant.id,
      livekit_room_name: roomName,
      caller_number: to,
      called_number: from,
      status: 'in_progress',
      metadata: {
        direction: 'outbound',
        initiatedBy: 'admin-api',
        conversationId: conversation.id,
      },
    });
    insertedCallId = call.id;

    const livekitHost = livekitHttpUrl(config.LIVEKIT_URL);
    const roomClient = new RoomServiceClient(
      livekitHost,
      config.LIVEKIT_API_KEY,
      config.LIVEKIT_API_SECRET,
    );
    const dispatchClient = new AgentDispatchClient(
      livekitHost,
      config.LIVEKIT_API_KEY,
      config.LIVEKIT_API_SECRET,
    );
    const sipClient = new SipClient(livekitHost, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

    await roomClient.createRoom({
      name: roomName,
      emptyTimeout: 120,
      departureTimeout: 30,
      maxParticipants: 2,
      metadata: JSON.stringify({
        tenantId: details.tenant.id,
        callId: call.id,
        direction: 'outbound',
      }),
    });

    const dispatch = await dispatchClient.createDispatch(roomName, config.LIVEKIT_AGENT_NAME, {
      metadata: JSON.stringify({
        tenantId: details.tenant.id,
        callId: call.id,
        direction: 'outbound',
      }),
    });

    const sipParticipant = await sipClient.createSipParticipant(
      config.LIVEKIT_SIP_OUTBOUND_TRUNK_ID,
      to,
      roomName,
      {
        fromNumber: from,
        participantIdentity: `outbound-${call.id}`,
        participantName: to,
        participantAttributes: {
          'va.direction': 'outbound',
          'va.tenantId': details.tenant.id,
          'va.tenantSlug': details.tenant.slug,
          'va.callId': call.id,
          'va.conversationId': conversation.id,
          'va.contactPhone': to,
          'va.fromNumber': from,
          ...(parsed.data.first_message ? { 'va.firstMessage': parsed.data.first_message } : {}),
        },
        playDialtone: true,
        ringingTimeout: parsed.data.ringing_timeout_seconds,
        maxCallDuration: parsed.data.max_call_duration_seconds,
        waitUntilAnswered: parsed.data.wait_until_answered,
        timeout: parsed.data.wait_until_answered ? parsed.data.ringing_timeout_seconds + 10 : 10,
      },
    );

    return c.json(
      {
        call,
        conversation_id: conversation.id,
        room_name: roomName,
        dispatch_id: dispatch.id,
        sip_participant_id: sipParticipant.participantId,
        to,
        from,
      },
      201,
    );
  } catch (error) {
    if (insertedCallId) {
      await updateCallEnded(insertedCallId, 'failed').catch(() => undefined);
    }

    return handleAdminRouteError(c, error);
  }
});

function livekitHttpUrl(url: string): string {
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

function outboundRoomName(tenantSlug: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `outbound-${tenantSlug}-${suffix}`;
}
