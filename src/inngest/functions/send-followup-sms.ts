import { config } from '../../config.js';
import {
  bumpConversationLastMessageAt,
  getOrCreateConversationByContact,
} from '../../db/conversations.js';
import { insertMessage } from '../../db/messages.js';
import { getTenantByPhoneNumber } from '../../db/tenants.js';
import type { TenantStatus } from '../../db/types.js';
import { logger } from '../../logger.js';
import { sendSms } from '../../twilio/client.js';
import { normalizePhoneE164 } from '../../utils/phone.js';
import { inngest } from '../client.js';
import { voiceCallCompletedEvent } from '../events.js';

type FollowupContext =
  | {
      ok: true;
      tenantStatus: TenantStatus;
      contactPhone: string;
      template: string;
      delaySeconds: number;
    }
  | {
      ok: false;
      reason: string;
      tenantStatus?: TenantStatus;
    };

const functionLogger = logger.child({ component: 'inngest', function: 'send-followup-sms' });

export const sendFollowupSms = inngest.createFunction(
  {
    id: 'send-followup-sms',
    name: 'Send post-call follow-up SMS',
    triggers: [{ event: voiceCallCompletedEvent }],
    idempotency: 'event.data.callId',
  },
  async ({ event, step }) => {
    const { calledNumber, callId, contactPhone, durationMs, tenantId } = event.data;
    const logFields = {
      callId,
      tenantId,
      durationMs,
    };

    const context = await step.run('load-tenant-and-config', async (): Promise<FollowupContext> => {
      if (!config.FOLLOWUP_SMS_ENABLED) {
        return {
          ok: false,
          reason: 'followup_disabled',
        };
      }

      const normalizedContact = normalizePhoneE164(contactPhone);

      if (!normalizedContact) {
        return {
          ok: false,
          reason: 'invalid_contact_phone',
        };
      }

      const tenantConfig = await getTenantByPhoneNumber(calledNumber);

      if (!tenantConfig || tenantConfig.tenant.id !== tenantId) {
        return {
          ok: false,
          reason: 'tenant_not_found',
        };
      }

      if (tenantConfig.tenant.status !== 'active') {
        return {
          ok: false,
          reason: 'tenant_not_active',
          tenantStatus: tenantConfig.tenant.status,
        };
      }

      const template = tenantConfig.sms_config?.follow_up_sms_template?.trim();

      if (!template) {
        return {
          ok: false,
          reason: 'followup_template_not_configured',
          tenantStatus: tenantConfig.tenant.status,
        };
      }

      return {
        ok: true,
        tenantStatus: tenantConfig.tenant.status,
        contactPhone: normalizedContact,
        template,
        delaySeconds: tenantConfig.sms_config?.follow_up_delay_seconds ?? 60,
      };
    });

    if (!context.ok) {
      functionLogger.info({ ...logFields, reason: context.reason }, 'skipping follow-up SMS');
      return {
        skipped: context.reason,
      };
    }

    await step.sleep('debounce', `${context.delaySeconds}s`);

    const outbound = await step.run('send-followup', async () => {
      return sendSms({
        from: calledNumber,
        to: context.contactPhone,
        body: context.template,
      });
    });

    const persisted = await step.run('persist-followup', async () => {
      const conversation = await getOrCreateConversationByContact({
        tenantId,
        contactPhone: context.contactPhone,
      });

      return insertMessage({
        conversationId: conversation.id,
        tenantId,
        channel: 'sms',
        role: 'assistant',
        content: context.template,
        callId,
        externalId: outbound.sid,
        metadata: {
          source: 'twilio',
          twilioMessageSid: outbound.sid,
          followupForCallId: callId,
        },
      });
    });

    await step.run('bump-conversation', async () => {
      await bumpConversationLastMessageAt({
        tenantId,
        conversationId: persisted.conversation_id,
        lastMessageAt: persisted.created_at,
      });
    });

    return {
      callId,
      outboundMessageSid: outbound.sid,
      persistedMessageId: persisted.id,
    };
  },
);
