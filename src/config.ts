import { z } from 'zod';
import { DEFAULT_NO_TENANT_FALLBACK } from './instructions.js';

const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();

const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

const envSchema = z.object({
  LIVEKIT_URL: optionalNonEmptyString.refine(
    (value) => value === undefined || value.startsWith('ws://') || value.startsWith('wss://'),
    'LIVEKIT_URL must be a LiveKit websocket URL starting with ws:// or wss://',
  ),
  LIVEKIT_API_KEY: optionalNonEmptyString,
  LIVEKIT_API_SECRET: optionalNonEmptyString,
  OPENAI_API_KEY: optionalNonEmptyString,
  LIVEKIT_AGENT_NAME: nonEmptyString.default('inbound-agent'),
  SUPABASE_URL: nonEmptyString.url(),
  SUPABASE_SERVICE_ROLE_KEY: nonEmptyString,
  ADMIN_API_KEY: optionalNonEmptyString,
  API_PORT: z.coerce.number().int().positive().default(8787),
  NO_TENANT_FALLBACK_MESSAGE: nonEmptyString.default(DEFAULT_NO_TENANT_FALLBACK),
  LOG_LEVEL: logLevelSchema.default('info'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = z.prettifyError(parsedEnv.error);
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const config = parsedEnv.data;

export type AppConfig = typeof config;

const workerEnvSchema = envSchema.required({
  LIVEKIT_URL: true,
  LIVEKIT_API_KEY: true,
  LIVEKIT_API_SECRET: true,
  OPENAI_API_KEY: true,
});

const apiEnvSchema = envSchema.required({
  ADMIN_API_KEY: true,
});

function parseConfigForProcess<T extends z.ZodType>(schema: T, processName: string): z.infer<T> {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = z.prettifyError(parsed.error);
    throw new Error(`Invalid ${processName} environment configuration:\n${details}`);
  }

  return parsed.data;
}

export function getWorkerConfig() {
  return parseConfigForProcess(workerEnvSchema, 'worker');
}

export function getApiConfig() {
  return parseConfigForProcess(apiEnvSchema, 'admin API');
}
