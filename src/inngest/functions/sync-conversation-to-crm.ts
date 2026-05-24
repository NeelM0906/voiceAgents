import { resolveCrmConnector } from '../../crm/client.js';
import { formatConversationNote } from '../../crm/format.js';
import { getCallById } from '../../db/calls.js';
import { supabase } from '../../db/client.js';
import {
  getConversation,
  getOrCreateConversationByContact,
  updateConversationCrmSync,
} from '../../db/conversations.js';
import { listEscalationsForConversation } from '../../db/escalations.js';
import { listAllMessagesByConversation } from '../../db/messages.js';
import type { CallRow, ConversationRow, TenantRow } from '../../db/types.js';
import { logger } from '../../logger.js';
import { inngest } from '../client.js';
import { callSummaryReadyEvent, crmSyncRequestedEvent, voiceCallCompletedEvent } from '../events.js';

type SyncContext =
  | {
      ok: true;
      tenant: TenantRow;
      conversation: ConversationRow;
      contactPhone: string;
      callId: string | null;
      waitForSummary: boolean;
    }
  | {
      ok: false;
      reason: string;
      tenantId: string;
      callId?: string | null;
      conversationId?: string | null;
    };

const functionLogger = logger.child({ component: 'inngest', function: 'sync-conversation-to-crm' });

export const syncConversationToCrm = inngest.createFunction(
  {
    id: 'sync-conversation-to-crm',
    name: 'Sync conversation to CRM',
    triggers: [{ event: voiceCallCompletedEvent }, { event: crmSyncRequestedEvent }],
    idempotency: 'event.id',
  },
  async ({ event, step }) => {
    const context = await step.run('load-sync-context', async (): Promise<SyncContext> => {
      const data = event.data;
      const tenantId = data.tenantId;
      const contactPhone = data.contactPhone;
      const callId = 'callId' in data ? data.callId ?? null : null;
      const conversationId = 'conversationId' in data ? data.conversationId ?? null : null;
      const waitForSummary = event.name === 'voice/call.completed' && Boolean(callId);

      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .maybeSingle();

      if (tenantError) {
        throw tenantError;
      }

      if (!tenant || tenant.status !== 'active') {
        return {
          ok: false,
          reason: 'tenant_not_active',
          tenantId,
          callId,
          conversationId,
        };
      }

      const conversation = conversationId
        ? await getConversation({ tenantId, conversationId })
        : await getOrCreateConversationByContact({ tenantId, contactPhone });

      if (!conversation) {
        return {
          ok: false,
          reason: 'conversation_not_found',
          tenantId,
          callId,
          conversationId,
        };
      }

      return {
        ok: true,
        tenant,
        conversation,
        contactPhone,
        callId,
        waitForSummary,
      };
    });

    if (!context.ok) {
      functionLogger.info(
        {
          tenantId: context.tenantId,
          callId: context.callId,
          conversationId: context.conversationId,
          reason: context.reason,
        },
        'skipping CRM sync',
      );
      return {
        skipped: context.reason,
      };
    }

    const crm = await resolveCrmConnector(context.tenant.id);

    if (!crm) {
      functionLogger.info(
        {
          tenantId: context.tenant.id,
          conversationId: context.conversation.id,
          reason: 'crm_not_configured',
        },
        'skipping CRM sync',
      );
      return {
        skipped: 'crm_not_configured',
      };
    }

    if (context.waitForSummary && context.callId) {
      await step.waitForEvent('wait-for-summary', {
        event: callSummaryReadyEvent,
        timeout: '60s',
        match: 'data.callId == event.data.callId',
      });
    }

    const loaded = await step.run('load-conversation-material', async () => {
      const [messages, call, escalations] = await Promise.all([
        listAllMessagesByConversation({
          tenantId: context.tenant.id,
          conversationId: context.conversation.id,
          limit: 500,
        }),
        context.callId ? getCallById({ tenantId: context.tenant.id, callId: context.callId }) : null,
        listEscalationsForConversation({
          tenantId: context.tenant.id,
          conversationId: context.conversation.id,
        }),
      ]);

      return {
        messages,
        call,
        escalations,
      };
    });

    const contact = await step.run('upsert-crm-contact', async () => {
      return crm.connector.upsertContact({
        phone: context.contactPhone,
        name: extractContactName(loaded.call),
        tags: ['ai-receptionist'],
      });
    });

    await step.run('append-crm-note', async () => {
      const note = formatConversationNote({
        tenantName: context.tenant.name,
        contactPhone: context.contactPhone,
        call: loaded.call,
        messages: loaded.messages,
        escalations: loaded.escalations,
      });

      await crm.connector.appendNote({
        contactId: contact.contactId,
        body: note,
      });
    });

    if (
      crm.config.pipeline_id &&
      crm.config.default_stage_id &&
      !context.conversation.crm_last_synced_at &&
      crm.connector.addToPipeline
    ) {
      await step.run('add-to-crm-pipeline', async () => {
        await crm.connector.addToPipeline?.({
          contactId: contact.contactId,
          pipelineId: crm.config.pipeline_id as string,
          stageId: crm.config.default_stage_id as string,
        });
      });
    }

    await step.run('mark-crm-synced', async () => {
      await updateConversationCrmSync({
        tenantId: context.tenant.id,
        conversationId: context.conversation.id,
        crmContactId: contact.contactId,
      });
    });

    functionLogger.info(
      {
        tenantId: context.tenant.id,
        conversationId: context.conversation.id,
        callId: context.callId,
      },
      'conversation synced to CRM',
    );

    return {
      conversationId: context.conversation.id,
      crmContactId: contact.contactId,
    };
  },
);

function extractContactName(call: CallRow | null): string | undefined {
  const keyFacts = call?.key_facts;

  if (!keyFacts || typeof keyFacts !== 'object' || Array.isArray(keyFacts)) {
    return undefined;
  }

  for (const key of ['caller_name', 'name', 'callerName']) {
    const value = (keyFacts as Record<string, unknown>)[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}
