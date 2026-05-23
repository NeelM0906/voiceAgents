import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

const envSchema = z.object({
  LIVEKIT_URL: nonEmptyString.refine(
    (value) => value.startsWith('ws://') || value.startsWith('wss://'),
    'LIVEKIT_URL must be a LiveKit websocket URL starting with ws:// or wss://',
  ),
  LIVEKIT_API_KEY: nonEmptyString,
  LIVEKIT_API_SECRET: nonEmptyString,
  OPENAI_API_KEY: nonEmptyString,
  AGENT_NAME: nonEmptyString.default('voice-agent'),
  OPENAI_REALTIME_MODEL: nonEmptyString.default('gpt-realtime'),
  OPENAI_REALTIME_VOICE: nonEmptyString.default('marin'),
  LOG_LEVEL: logLevelSchema.default('info'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = z.prettifyError(parsedEnv.error);
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const config = parsedEnv.data;

export type AppConfig = typeof config;
