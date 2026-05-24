import { insertEscalation } from './db/escalations.js';
import { inngest } from './inngest/client.js';
import { escalationTriggeredEvent } from './inngest/events.js';

export type FlagEmergencyInput = {
  tenantId: string;
  source: 'voice' | 'sms';
  reason: string;
  severity?: 'high' | 'critical';
  contactPhone?: string | null;
  conversationId?: string | null;
  callId?: string | null;
};

export async function flagEmergency(input: FlagEmergencyInput): Promise<{
  ok: true;
  message: string;
  escalationId: string;
}> {
  const reason = input.reason.trim().slice(0, 200);

  if (!reason) {
    throw new Error('flag_emergency reason is required');
  }

  const escalation = await insertEscalation({
    tenantId: input.tenantId,
    source: input.source,
    reason,
    contactPhone: input.contactPhone,
    conversationId: input.conversationId,
    callId: input.callId,
  });

  await inngest.send(
    escalationTriggeredEvent.create(
      {
        escalationId: escalation.id,
        tenantId: input.tenantId,
        source: input.source,
        reason,
        severity: input.severity ?? 'high',
        contactPhone: input.contactPhone ?? null,
        conversationId: input.conversationId ?? null,
        callId: input.callId ?? null,
      },
      {
        id: escalation.id,
      },
    ),
  );

  return {
    ok: true,
    message: 'Owner has been notified.',
    escalationId: escalation.id,
  };
}
