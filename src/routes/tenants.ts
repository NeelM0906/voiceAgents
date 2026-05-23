import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  DbConflictError,
  DbNotFoundError,
  addPhoneNumber,
  createTenant,
  getTenantBySlugOrId,
  removePhoneNumber,
  updateTenantStatus,
  updateVoiceConfig,
} from '../db/tenants.js';
import { logger } from '../logger.js';

const apiLogger = logger.child({ component: 'admin-api', route: 'tenants' });

const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case');

const nonEmptyString = z.string().trim().min(1);

const voiceConfigSchema = z.object({
  business_name: nonEmptyString,
  first_message: nonEmptyString,
  system_prompt: nonEmptyString,
  voice: nonEmptyString.default('marin'),
  model: nonEmptyString.default('gpt-realtime'),
});

const createTenantSchema = z.object({
  slug: slugSchema,
  name: nonEmptyString.max(100),
  voice_config: voiceConfigSchema,
});

const updateVoiceConfigSchema = voiceConfigSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'at least one voice config field is required',
);

const phoneNumberSchema = z.object({
  phone_number: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{1,14}$/, 'must be E.164, for example +15551234567'),
});

const statusSchema = z.object({
  status: z.enum(['active', 'paused']),
});

type JsonParseResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      response: Response;
    };

async function parseJsonBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<JsonParseResult<z.output<T>>> {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json({ error: 'invalid_json' }, 400),
    };
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        {
          error: 'invalid_request',
          details: z.treeifyError(parsed.error),
        },
        400,
      ),
    };
  }

  return {
    ok: true,
    data: parsed.data,
  };
}

function handleRouteError(c: Context, error: unknown): Response {
  if (error instanceof DbConflictError) {
    return c.json({ error: 'conflict', message: error.message }, 409);
  }

  if (error instanceof DbNotFoundError) {
    return c.json({ error: 'not_found', message: error.message }, 404);
  }

  apiLogger.error({ error }, 'admin route error');
  return c.json({ error: 'internal_error' }, 500);
}

export const tenantRoutes = new Hono();

tenantRoutes.post('/', async (c) => {
  const parsed = await parseJsonBody(c, createTenantSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const created = await createTenant(parsed.data);
    return c.json(created, 201);
  } catch (error) {
    return handleRouteError(c, error);
  }
});

tenantRoutes.get('/:slugOrId', async (c) => {
  const slugOrId = c.req.param('slugOrId');

  try {
    const details = await getTenantBySlugOrId(slugOrId);

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    return c.json(details);
  } catch (error) {
    return handleRouteError(c, error);
  }
});

tenantRoutes.patch('/:slugOrId/voice-config', async (c) => {
  const parsed = await parseJsonBody(c, updateVoiceConfigSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const voiceConfig = await updateVoiceConfig(c.req.param('slugOrId'), parsed.data);
    return c.json({ voice_config: voiceConfig });
  } catch (error) {
    return handleRouteError(c, error);
  }
});

tenantRoutes.post('/:slugOrId/phone-numbers', async (c) => {
  const parsed = await parseJsonBody(c, phoneNumberSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const phoneNumber = await addPhoneNumber(c.req.param('slugOrId'), parsed.data.phone_number);
    return c.json(
      {
        phone_number: phoneNumber.phone_number,
        tenant_id: phoneNumber.tenant_id,
      },
      201,
    );
  } catch (error) {
    return handleRouteError(c, error);
  }
});

tenantRoutes.delete('/:slugOrId/phone-numbers/:phoneNumber', async (c) => {
  try {
    await removePhoneNumber(c.req.param('slugOrId'), c.req.param('phoneNumber'));
    return c.body(null, 204);
  } catch (error) {
    return handleRouteError(c, error);
  }
});

tenantRoutes.patch('/:slugOrId/status', async (c) => {
  const parsed = await parseJsonBody(c, statusSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const tenant = await updateTenantStatus(c.req.param('slugOrId'), parsed.data.status);
    return c.json({ tenant });
  } catch (error) {
    return handleRouteError(c, error);
  }
});
