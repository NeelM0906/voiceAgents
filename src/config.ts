import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_NO_TENANT_FALLBACK } from './instructions.js';

function loadDotEnvLocal() {
  if (!existsSync('.env.local')) {
    return;
  }

  const lines = readFileSync('.env.local', 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');

    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();

    if (process.env[key] !== undefined) {
      continue;
    }

    const rawValue = trimmed.slice(separator + 1).trim();
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    process.env[key] = value;
  }
}

loadDotEnvLocal();

const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();
const optionalString = z.string().trim().optional();

const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const ragPipelineSchema = z.enum(['hybrid', 'page_index']);
const booleanEnvSchema = z
  .preprocess(
    (value) => (value === undefined ? undefined : String(value).trim().toLowerCase()),
    z.enum(['true', 'false']).default('true'),
  )
  .transform((value) => value === 'true');

const envSchema = z.object({
  LIVEKIT_URL: optionalNonEmptyString.refine(
    (value) => value === undefined || value.startsWith('ws://') || value.startsWith('wss://'),
    'LIVEKIT_URL must be a LiveKit websocket URL starting with ws:// or wss://',
  ),
  LIVEKIT_API_KEY: optionalNonEmptyString,
  LIVEKIT_API_SECRET: optionalNonEmptyString,
  OPENAI_API_KEY: optionalNonEmptyString,
  TWILIO_ACCOUNT_SID: optionalNonEmptyString,
  TWILIO_AUTH_TOKEN: optionalNonEmptyString,
  INNGEST_EVENT_KEY: optionalString,
  INNGEST_SIGNING_KEY: optionalString,
  INNGEST_APP_ID: nonEmptyString.default('voice-agents'),
  PUBLIC_BASE_URL: nonEmptyString.url().default('http://localhost:8787'),
  OPENAI_SMS_MODEL: nonEmptyString.default('gpt-4o-mini'),
  SMS_HISTORY_WINDOW: z.coerce.number().int().positive().default(20),
  FOLLOWUP_SMS_ENABLED: booleanEnvSchema,
  LIVEKIT_AGENT_NAME: nonEmptyString.default('inbound-agent'),
  SUPABASE_URL: nonEmptyString.url(),
  SUPABASE_SERVICE_ROLE_KEY: nonEmptyString,
  ADMIN_API_KEY: optionalNonEmptyString,
  API_PORT: z.coerce.number().int().positive().default(8787),
  NO_TENANT_FALLBACK_MESSAGE: nonEmptyString.default(DEFAULT_NO_TENANT_FALLBACK),
  LOG_LEVEL: logLevelSchema.default('info'),
  RAG_WINNER: ragPipelineSchema,
  RAG_TOP_K: z.coerce.number().int().min(1).max(50).default(8),
  OPENAI_EMBED_MODEL: nonEmptyString.default('text-embedding-3-small'),
  HYBRID_HYDE_ENABLED: booleanEnvSchema,
  HYBRID_HYDE_MODEL: nonEmptyString.default('gpt-4o-mini'),
  HYBRID_RERANK_ENABLED: booleanEnvSchema,
  COHERE_API_KEY: optionalNonEmptyString,
  COHERE_RERANK_MODEL: nonEmptyString.default('rerank-v3.5'),
  PAGEINDEX_NAVIGATOR_MODEL: nonEmptyString.default('gpt-4o-mini'),
  PAGEINDEX_SUMMARY_MODEL: nonEmptyString.default('gpt-4o-mini'),
  PAGEINDEX_MAX_DEPTH: z.coerce.number().int().min(1).max(12).default(4),
  PAGEINDEX_MAX_FANOUT: z.coerce.number().int().min(1).max(10).default(3),
  EVAL_JUDGE_MODEL: nonEmptyString.default('gpt-4o'),
  EVAL_DATASET_PATH: optionalString.default('eval/dataset.jsonl'),
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
  OPENAI_API_KEY: true,
  TWILIO_ACCOUNT_SID: true,
  TWILIO_AUTH_TOKEN: true,
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
