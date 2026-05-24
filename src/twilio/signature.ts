import twilio from 'twilio';

export function validateTwilioSignature(input: {
  authToken: string;
  signature: string | null | undefined;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (!input.signature) {
    return false;
  }

  return twilio.validateRequest(input.authToken, input.signature, input.url, input.params);
}
