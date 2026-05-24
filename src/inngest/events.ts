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

export type CallSummaryReadyData = {
  callId: string;
  tenantId: string;
  conversationId?: string | null;
};

export type CrmSyncRequestedData = {
  tenantId: string;
  conversationId: string;
  contactPhone: string;
  callId?: string | null;
  reason: 'call_completed' | 'sms_reply_sent' | 'manual_test';
  latestMessageAt?: string | null;
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

export const callSummaryReadyEvent = eventType('call/summary.ready', {
  schema: staticSchema<CallSummaryReadyData>(),
});

export const crmSyncRequestedEvent = eventType('call/sync-to-crm.requested', {
  schema: staticSchema<CrmSyncRequestedData>(),
});
