import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.js';
import {
  createSmsConfig,
  getSmsConfig,
  patchSmsConfig,
} from '../db/sms_configs.js';
import { DbNotFoundError, getTenantBySlugOrId } from '../db/tenants.js';
import { handleAdminRouteError, parseJsonBody } from './admin-utils.js';

const nonEmptyString = z.string().trim().min(1);

const createSmsConfigSchema = z.object({
  system_prompt: nonEmptyString,
  model: nonEmptyString.default(config.OPENAI_SMS_MODEL),
  follow_up_sms_template: z.string().trim().min(1).nullable().optional(),
  follow_up_delay_seconds: z.number().int().min(0).max(3600).default(60),
});

const patchSmsConfigSchema = createSmsConfigSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'at least one SMS config field is required',
);

export const smsConfigRoutes = new Hono();

smsConfigRoutes.get('/:slugOrId/sms-config', async (c) => {
  try {
    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    const smsConfig = await getSmsConfig(details.tenant.id);

    if (!smsConfig) {
      return c.json({ error: 'not_found' }, 404);
    }

    return c.json({ sms_config: smsConfig });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

smsConfigRoutes.post('/:slugOrId/sms-config', async (c) => {
  const parsed = await parseJsonBody(c, createSmsConfigSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    const smsConfig = await createSmsConfig({
      tenant_id: details.tenant.id,
      ...parsed.data,
    });

    return c.json({ sms_config: smsConfig }, 201);
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

smsConfigRoutes.patch('/:slugOrId/sms-config', async (c) => {
  const parsed = await parseJsonBody(c, patchSmsConfigSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    const existing = await getSmsConfig(details.tenant.id);

    if (!existing) {
      throw new DbNotFoundError(`SMS config not found for tenant: ${details.tenant.id}`);
    }

    const smsConfig = await patchSmsConfig({
      tenantId: details.tenant.id,
      updates: parsed.data,
    });

    return c.json({ sms_config: smsConfig });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});
