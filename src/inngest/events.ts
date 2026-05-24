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
};

export const smsInboundReceivedEvent = eventType('sms/inbound.received', {
  schema: staticSchema<SmsInboundReceivedData>(),
});

export const voiceCallCompletedEvent = eventType('voice/call.completed', {
  schema: staticSchema<VoiceCallCompletedData>(),
});
