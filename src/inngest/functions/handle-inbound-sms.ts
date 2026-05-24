import { config } from '../../config.js';
import { bumpConversationLastMessageAt } from '../../db/conversations.js';
import { recentMessagesForContext } from '../../db/messages.js';
import { insertMessage, insertMessageOnceByExternalId } from '../../db/messages.js';
import { getTenantByPhoneNumber } from '../../db/tenants.js';
import type { MessageRow, TenantSmsConfigRow, TenantStatus } from '../../db/types.js';
import { generateSmsReply } from '../../llm/sms.js';
import { logger } from '../../logger.js';
import { OptedOutError, sendSms } from '../../twilio/client.js';
import { inngest } from '../client.js';
import { crmSyncRequestedEvent, smsInboundReceivedEvent } from '../events.js';

type LoadedContext =
  | {
      ok: true;
      tenantStatus: TenantStatus;
      smsConfig: TenantSmsConfigRow;
      history: MessageRow[];
    }
  | {
      ok: false;
      reason: string;
      tenantStatus?: TenantStatus;
    };

const functionLogger = logger.child({ component: 'inngest', function: 'handle-inbound-sms' });

export const handleInboundSms = inngest.createFunction(
  {
    id: 'handle-inbound-sms',
    name: 'Handle inbound SMS',
    triggers: [{ event: smsInboundReceivedEvent }],
    idempotency: 'event.data.messageSid',
    concurrency: {
      limit: 1,
      key: 'event.data.conversationId',
    },
  },
  async ({ event, step }) => {
    const { body, calledNumber, contactPhone, conversationId, messageSid, tenantId } = event.data;
    const logFields = {
      messageSid,
      length: body.length,
      tenantId,
      conversationId,
    };

    const context = await step.run('load-context', async (): Promise<LoadedContext> => {
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

      if (!tenantConfig.sms_config) {
        return {
          ok: false,
          reason: 'sms_config_not_found',
          tenantStatus: tenantConfig.tenant.status,
        };
      }

      const history = await recentMessagesForContext({
        tenantId,
        conversationId,
        limit: config.SMS_HISTORY_WINDOW,
      });

      return {
        ok: true,
        tenantStatus: tenantConfig.tenant.status,
        smsConfig: tenantConfig.sms_config,
        history,
      };
    });

    if (!context.ok) {
      functionLogger.warn({ ...logFields, reason: context.reason }, 'skipping inbound SMS');
      return {
        skipped: context.reason,
      };
    }

    const persistedUser = await step.run('persist-user-message', async () => {
      return insertMessageOnceByExternalId({
        conversationId,
        tenantId,
        channel: 'sms',
        role: 'user',
        content: body,
        externalId: messageSid,
        metadata: {
          source: 'twilio',
          twilioMessageSid: messageSid,
        },
      });
    });

    if (!persistedUser.inserted) {
      functionLogger.warn({ ...logFields }, 'skipping duplicate inbound SMS');
      return {
        skipped: 'duplicate_message_sid',
      };
    }

    const reply = await step.run('generate-reply', async () => {
      functionLogger.info(
        {
          ...logFields,
          historyCount: context.history.length,
        },
        'generating SMS reply',
      );

      return generateSmsReply({
        systemPrompt: context.smsConfig.system_prompt,
        model: context.smsConfig.model,
        history: context.history.map((message) => ({
          role: message.role,
          content: message.content,
          channel: message.channel,
          createdAt: new Date(message.created_at),
        })),
        userMessage: body,
        tenantId,
        conversationId,
        contactPhone,
      });
    });

    const outbound = await step.run('send-sms', async () => {
      try {
        return await sendSms({
          tenantId,
          contactPhone,
          from: calledNumber,
          to: contactPhone,
          body: reply,
        });
      } catch (error) {
        if (error instanceof OptedOutError) {
          functionLogger.info({ ...logFields, reason: 'opted_out' }, 'skipping SMS reply');
          return null;
        }

        throw error;
      }
    });

    if (!outbound) {
      return {
        skipped: 'opted_out',
      };
    }

    const assistantMessage = await step.run('persist-assistant-message', async () => {
      return insertMessage({
        conversationId,
        tenantId,
        channel: 'sms',
        role: 'assistant',
        content: reply,
        externalId: outbound.sid,
        metadata: {
          source: 'twilio',
          twilioMessageSid: outbound.sid,
          replyToMessageSid: messageSid,
        },
      });
    });

    await step.run('bump-conversation', async () => {
      await bumpConversationLastMessageAt({
        tenantId,
        conversationId,
        lastMessageAt: assistantMessage.created_at,
      });
    });

    await step.run('queue-crm-sync', async () => {
      await inngest.send(
        crmSyncRequestedEvent.create(
          {
            tenantId,
            conversationId,
            contactPhone,
            reason: 'sms_reply_sent',
            latestMessageAt: assistantMessage.created_at,
          },
          {
            id: `${conversationId}:${assistantMessage.created_at}`,
          },
        ),
      );
    });

    return {
      messageSid,
      outboundMessageSid: outbound.sid,
      persistedMessageId: assistantMessage.id,
    };
  },
);
