import { Hono } from 'hono';
import { CohereClient } from 'cohere-ai';
import twilio from 'twilio';
import { config } from '../config.js';
import { supabase } from '../db/client.js';

export const healthRoutes = new Hono();

healthRoutes.get('/healthz', async (c) => {
  const { error } = await supabase.from('tenants').select('id', {
    count: 'exact',
    head: true,
  });

  return c.json({
    ok: true,
    supabase: error ? 'unreachable' : 'reachable',
  });
});

healthRoutes.get('/readyz', async (c) => {
  const checks = await Promise.all([
    runCheck('db', checkDb),
    runCheck('twilio', checkTwilio),
    runCheck('openai', checkOpenAI),
    runCheck('cohere', checkCohere),
    runCheck('inngest', checkInngest),
  ]);
  const result = Object.fromEntries(checks.map((check) => [check.name, check.result]));
  const ok = checks.every((check) => check.result.ok);

  return c.json(
    {
      ok,
      checks: result,
    },
    ok ? 200 : 503,
  );
});

type CheckResult = {
  ok: boolean;
  detail?: string;
};

async function runCheck(
  name: string,
  fn: (signal: AbortSignal) => Promise<CheckResult>,
): Promise<{ name: string; result: CheckResult }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    return {
      name,
      result: await fn(controller.signal),
    };
  } catch (error) {
    return {
      name,
      result: {
        ok: false,
        detail: error instanceof Error ? error.message : 'check failed',
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDb(_signal: AbortSignal): Promise<CheckResult> {
  const { error } = await supabase.from('tenants').select('id', {
    count: 'exact',
    head: true,
  });

  return error ? { ok: false, detail: error.message } : { ok: true };
}

async function checkTwilio(_signal: AbortSignal): Promise<CheckResult> {
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
    return {
      ok: false,
      detail: 'Twilio credentials are not configured',
    };
  }

  const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  await client.api.v2010.accounts(config.TWILIO_ACCOUNT_SID).fetch();
  return { ok: true };
}

async function checkOpenAI(signal: AbortSignal): Promise<CheckResult> {
  if (!config.OPENAI_API_KEY) {
    return {
      ok: false,
      detail: 'OPENAI_API_KEY is not configured',
    };
  }

  const response = await fetch('https://api.openai.com/v1/models', {
    headers: {
      authorization: `Bearer ${config.OPENAI_API_KEY}`,
    },
    signal,
  });

  return response.ok
    ? { ok: true }
    : { ok: false, detail: `OpenAI HTTP ${response.status}` };
}

async function checkCohere(_signal: AbortSignal): Promise<CheckResult> {
  if (!config.HYBRID_RERANK_ENABLED) {
    return {
      ok: true,
      detail: 'skipped',
    };
  }

  if (!config.COHERE_API_KEY) {
    return {
      ok: false,
      detail: 'COHERE_API_KEY is required when HYBRID_RERANK_ENABLED=true',
    };
  }

  const client = new CohereClient({
    token: config.COHERE_API_KEY,
  });
  await client.rerank({
    model: config.COHERE_RERANK_MODEL,
    query: 'health check',
    documents: ['health check'],
    topN: 1,
    returnDocuments: false,
  });
  return { ok: true };
}

async function checkInngest(_signal: AbortSignal): Promise<CheckResult> {
  const missing = [
    ['INNGEST_APP_ID', config.INNGEST_APP_ID],
    ['INNGEST_EVENT_KEY', config.INNGEST_EVENT_KEY],
    ['INNGEST_SIGNING_KEY', config.INNGEST_SIGNING_KEY],
  ]
    .filter(([, value]) => !String(value ?? '').trim())
    .map(([key]) => key);

  return missing.length === 0
    ? { ok: true }
    : { ok: false, detail: `missing ${missing.join(', ')}` };
}
