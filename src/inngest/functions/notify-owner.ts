import { config } from '../../config.js';
import { supabase } from '../../db/client.js';
import { updateEscalationOwnerNotification } from '../../db/escalations.js';
import type { TenantOwnerConfigRow, TenantRow } from '../../db/types.js';
import { logger } from '../../logger.js';
import { sendSmsRaw } from '../../twilio/client.js';
import { inngest } from '../client.js';
import { escalationTriggeredEvent } from '../events.js';

type OwnerContext =
  | {
      ok: true;
      tenant: TenantRow;
      ownerConfig: TenantOwnerConfigRow;
      fromNumber: string;
      ownerPhone: string;
    }
  | {
      ok: false;
      reason: string;
    };

const functionLogger = logger.child({ component: 'inngest', function: 'notify-owner' });

export const notifyOwner = inngest.createFunction(
  {
    id: 'notify-owner',
    name: 'Notify owner of emergency escalation',
    triggers: [{ event: escalationTriggeredEvent }],
    idempotency: 'event.data.escalationId',
  },
  async ({ event, step }) => {
    const { contactPhone, conversationId, escalationId, reason, source, tenantId } = event.data;
    const logFields = {
      escalationId,
      tenantId,
      source,
    };

    const context = await step.run('load-owner-config', async (): Promise<OwnerContext> => {
      if (!config.OWNER_NOTIFY_ENABLED) {
        return {
          ok: false,
          reason: 'owner_notifications_disabled',
        };
      }

      const [
        { data: tenant, error: tenantError },
        { data: ownerConfig, error: configError },
        { data: phoneRows, error: phoneError },
      ] = await Promise.all([
          supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
          supabase.from('tenant_owner_configs').select('*').eq('tenant_id', tenantId).maybeSingle(),
          supabase
            .from('tenant_phone_numbers')
            .select('phone_number')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: true })
            .limit(1),
        ]);

      if (tenantError) {
        throw tenantError;
      }

      if (configError) {
        throw configError;
      }

      if (phoneError) {
        throw phoneError;
      }

      if (!tenant) {
        return {
          ok: false,
          reason: 'tenant_not_found',
        };
      }

      if (!ownerConfig?.notify_on_emergency || !ownerConfig.owner_phone) {
        return {
          ok: false,
          reason: 'owner_notification_not_configured',
        };
      }

      const fromNumber = phoneRows?.[0]?.phone_number;

      if (!fromNumber) {
        return {
          ok: false,
          reason: 'tenant_phone_not_configured',
        };
      }

      return {
        ok: true,
        tenant,
        ownerConfig,
        fromNumber,
        ownerPhone: ownerConfig.owner_phone,
      };
    });

    if (!context.ok) {
      await step.run('mark-skipped', async () => {
        await updateEscalationOwnerNotification({
          escalationId,
          ownerNotifiedAt: null,
          ownerMessageSid: null,
        });
      });
      functionLogger.info({ ...logFields, reason: context.reason }, 'skipping owner notification');
      return {
        skipped: context.reason,
      };
    }

    const message = buildOwnerMessage({
      tenantName: context.tenant.name,
      tenantSlug: context.tenant.slug,
      contactPhone: contactPhone ?? 'unknown caller',
      reason,
      source,
      conversationId: conversationId ?? null,
    });

    const outbound = await step.run('send-owner-sms', async () => {
      return sendSmsRaw({
        from: context.fromNumber,
        to: context.ownerPhone,
        body: message,
      });
    });

    await step.run('mark-notified', async () => {
      await updateEscalationOwnerNotification({
        escalationId,
        ownerNotifiedAt: new Date().toISOString(),
        ownerMessageSid: outbound.sid,
      });
    });

    functionLogger.info({ ...logFields }, 'owner notification sent');

    return {
      escalationId,
      ownerMessageSid: outbound.sid,
    };
  },
);

function buildOwnerMessage(input: {
  tenantName: string;
  tenantSlug: string;
  contactPhone: string;
  reason: string;
  source: string;
  conversationId: string | null;
}): string {
  const viewPath = input.conversationId
    ? `/admin/tenants/${input.tenantSlug}/conversations/${input.conversationId}`
    : `/admin/tenants/${input.tenantSlug}`;
  const viewUrl = new URL(viewPath, config.PUBLIC_BASE_URL).toString();

  return `[${input.tenantName}] EMERGENCY from ${input.contactPhone}: ${input.reason}. Source: ${input.source}. View: ${viewUrl}`;
}
