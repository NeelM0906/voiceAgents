import twilio from 'twilio';
import { config } from '../config.js';

const accountSid = config.TWILIO_ACCOUNT_SID;
const authToken = config.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for Twilio REST');
}

const client = twilio(accountSid, authToken);

export async function sendSms(input: {
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
