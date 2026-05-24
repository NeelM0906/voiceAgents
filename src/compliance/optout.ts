import { isConsumerOptedOut } from '../db/optouts.js';

const STOP_KEYWORDS = /^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT|STOPALL)$/;
const START_KEYWORDS = /^(START|UNSTOP|YES)$/;
const HELP_KEYWORDS = /^HELP$/;

export type SmsComplianceKeyword = 'stop' | 'start' | 'help' | null;

export function detectSmsComplianceKeyword(body: string): SmsComplianceKeyword {
  const normalized = body.trim().toUpperCase();

  if (STOP_KEYWORDS.test(normalized)) {
    return 'stop';
  }

  if (START_KEYWORDS.test(normalized)) {
    return 'start';
  }

  if (HELP_KEYWORDS.test(normalized)) {
    return 'help';
  }

  return null;
}

export async function isOptedOut(input: {
  tenantId: string;
  contactPhone: string;
}): Promise<boolean> {
  return isConsumerOptedOut(input);
}
