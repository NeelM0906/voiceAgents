import { Inngest } from 'inngest';
import { config } from '../config.js';
import { logger } from '../logger.js';

function optionalEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const inngest = new Inngest({
  id: config.INNGEST_APP_ID,
  eventKey: optionalEnvValue(config.INNGEST_EVENT_KEY),
  signingKey: optionalEnvValue(config.INNGEST_SIGNING_KEY),
  logger: logger.child({ component: 'inngest' }),
});
