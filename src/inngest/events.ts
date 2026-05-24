import { eventType, staticSchema } from 'inngest';

export type SmsInboundReceivedData = {
  tenantId: string;
  conversationId: string;
  contactPhone: string;
  calledNumber: string;
  body: string;
  messageSid: string;
};

export type VoiceCallCompletedData = {
  callId: string;
  tenantId: string;
  contactPhone: string;
  calledNumber: string;
  durationMs: number;
  conversationId?: string | null;
};

export type EscalationTriggeredData = {
  escalationId: string;
  tenantId: string;
  source: 'voice' | 'sms';
  reason: string;
  severity: 'high' | 'critical';
  contactPhone?: string | null;
  conversationId?: string | null;
  callId?: string | null;
};

export const smsInboundReceivedEvent = eventType('sms/inbound.received', {
  schema: staticSchema<SmsInboundReceivedData>(),
});

export const voiceCallCompletedEvent = eventType('voice/call.completed', {
  schema: staticSchema<VoiceCallCompletedData>(),
});

export const escalationTriggeredEvent = eventType('escalation/triggered', {
  schema: staticSchema<EscalationTriggeredData>(),
});
