import twilio from 'twilio';
import { config } from '../config.js';
import { isConsumerOptedOut } from '../db/optouts.js';

const accountSid = config.TWILIO_ACCOUNT_SID;
const authToken = config.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for Twilio REST');
}

const client = twilio(accountSid, authToken);

export class OptedOutError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly contactPhone: string,
  ) {
    super(`Outbound SMS blocked because contact is opted out: ${tenantId}/${contactPhone}`);
    this.name = 'OptedOutError';
  }
}

export async function sendSmsRaw(input: {
  from: string;
  to: string;
  body: string;
}): Promise<{ sid: string }> {
  const message = await client.messages.create({
    body: input.body,
    from: input.from,
    to: input.to,
  });

  return {
    sid: message.sid,
  };
}

export async function sendSms(input: {
  tenantId: string;
  contactPhone: string;
  from: string;
  to: string;
  body: string;
}): Promise<{ sid: string }> {
  const optedOut = await isConsumerOptedOut({
    tenantId: input.tenantId,
    contactPhone: input.contactPhone,
  });

  if (optedOut) {
    throw new OptedOutError(input.tenantId, input.contactPhone);
  }

  return sendSmsRaw(input);
}
