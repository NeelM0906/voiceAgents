import { config } from '../../config.js';
import {
  bumpConversationLastMessageAt,
  getOrCreateConversationByContact,
} from '../../db/conversations.js';
import { insertMessage } from '../../db/messages.js';
import { insertReviewRequest, updateReviewRequest } from '../../db/review_requests.js';
import { supabase } from '../../db/client.js';
import type { TenantReviewConfigRow, TenantRow } from '../../db/types.js';
import { logger } from '../../logger.js';
import { OptedOutError, sendSms } from '../../twilio/client.js';
import { inngest } from '../client.js';
import { voiceCallCompletedEvent } from '../events.js';

type ReviewContext =
  | {
      ok: true;
      tenant: TenantRow;
      reviewConfig: TenantReviewConfigRow;
    }
  | {
      ok: false;
      reason: string;
      persistSkipped: boolean;
    };

const functionLogger = logger.child({ component: 'inngest', function: 'send-review-request' });

export const sendReviewRequest = inngest.createFunction(
  {
    id: 'send-review-request',
    name: 'Send post-call review request',
    triggers: [{ event: voiceCallCompletedEvent }],
    idempotency: 'event.data.callId',
  },
  async ({ event, step }) => {
    const { callId, calledNumber, contactPhone, durationMs, tenantId } = event.data;
    const logFields = {
      callId,
      tenantId,
      durationMs,
    };

    const context = await step.run('load-review-config', async (): Promise<ReviewContext> => {
      if (!config.REVIEW_REQUESTS_ENABLED) {
        return {
          ok: false,
          reason: 'review_requests_disabled',
          persistSkipped: false,
        };
      }

      const [{ data: tenant, error: tenantError }, { data: reviewConfig, error: configError }] =
        await Promise.all([
          supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
          supabase.from('tenant_review_configs').select('*').eq('tenant_id', tenantId).maybeSingle(),
        ]);

      if (tenantError) {
        throw tenantError;
      }

      if (configError) {
        throw configError;
      }

      if (!tenant || tenant.status !== 'active') {
        return {
          ok: false,
          reason: 'tenant_not_active',
          persistSkipped: true,
        };
      }

      if (!reviewConfig?.enabled) {
        return {
          ok: false,
          reason: 'review_not_enabled',
          persistSkipped: false,
        };
      }

      if (durationMs < reviewConfig.send_after_call_min_duration_seconds * 1000) {
        return {
          ok: false,
          reason: 'too_short',
          persistSkipped: true,
        };
      }

      return {
        ok: true,
        tenant,
        reviewConfig,
      };
    });

    if (!context.ok) {
      if (context.persistSkipped) {
        await step.run('persist-skipped-review', async () => {
          await insertReviewRequest({
            tenantId,
            callId,
            contactPhone,
            status: 'skipped',
            skippedReason: context.reason,
          });
        });
      }

      functionLogger.info({ ...logFields, reason: context.reason }, 'skipping review request');
      return {
        skipped: context.reason,
      };
    }

    const request = await step.run('queue-review-request', async () => {
      return insertReviewRequest({
        tenantId,
        callId,
        contactPhone,
        status: 'queued',
      });
    });

    if (!request.inserted) {
      functionLogger.info({ ...logFields }, 'review request already exists');
      return {
        skipped: 'already_exists',
      };
    }

    await step.sleep('review-delay', `${context.reviewConfig.delay_seconds}s`);

    const body = context.reviewConfig.template.replaceAll(
      '{review_link}',
      context.reviewConfig.review_link,
    );

    const outbound = await step.run('send-review-sms', async () => {
      try {
        return await sendSms({
          tenantId,
          contactPhone,
          from: calledNumber,
          to: contactPhone,
          body,
        });
      } catch (error) {
        if (error instanceof OptedOutError) {
          await updateReviewRequest({
            id: request.row.id,
            status: 'skipped',
            skippedReason: 'opted_out',
          });
          return null;
        }

        await updateReviewRequest({
          id: request.row.id,
          status: 'failed',
          skippedReason: 'send_failed',
        });
        throw error;
      }
    });

    if (!outbound) {
      functionLogger.info({ ...logFields, reason: 'opted_out' }, 'skipping review request');
      return {
        skipped: 'opted_out',
      };
    }

    await step.run('mark-review-sent', async () => {
      await updateReviewRequest({
        id: request.row.id,
        status: 'sent',
        messageSid: outbound.sid,
      });
    });

    const persisted = await step.run('persist-review-message', async () => {
      const conversation = await getOrCreateConversationByContact({
        tenantId,
        contactPhone,
      });

      return insertMessage({
        conversationId: conversation.id,
        tenantId,
        channel: 'sms',
        role: 'assistant',
        content: body,
        callId,
        externalId: outbound.sid,
        metadata: {
          source: 'twilio',
          twilioMessageSid: outbound.sid,
          reviewRequestId: request.row.id,
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

    functionLogger.info({ ...logFields }, 'review request sent');

    return {
      callId,
      messageSid: outbound.sid,
      reviewRequestId: request.row.id,
    };
  },
);
