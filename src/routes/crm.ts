import { Hono } from 'hono';
import { z } from 'zod';
import {
  getTenantCrmConfig,
  maskEncryptedCredential,
  resolveCrmConnector,
  upsertTenantCrmConfig,
} from '../crm/client.js';
import type { TenantCrmConfigRow } from '../db/types.js';
import { getTenantBySlugOrId } from '../db/tenants.js';
import { handleAdminRouteError, parseJsonBody } from './admin-utils.js';

const nonEmptyString = z.string().trim().min(1);

const crmConfigCreateSchema = z.object({
  provider: z.literal('ghl').default('ghl'),
  location_id: nonEmptyString,
  api_key: nonEmptyString,
  pipeline_id: z.string().trim().min(1).nullable().optional(),
  default_stage_id: z.string().trim().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
});

const crmConfigPatchSchema = crmConfigCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'at least one CRM config field is required',
);

export const crmRoutes = new Hono();

crmRoutes.get('/:slugOrId/crm-config', async (c) => {
  try {
    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    const crmConfig = await getTenantCrmConfig(details.tenant.id);

    if (!crmConfig) {
      return c.json({ crm_config: null });
    }

    return c.json({ crm_config: formatCrmConfig(crmConfig) });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

crmRoutes.post('/:slugOrId/crm-config', async (c) => {
  const parsed = await parseJsonBody(c, crmConfigCreateSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    const crmConfig = await upsertTenantCrmConfig({
      tenantId: details.tenant.id,
      locationId: parsed.data.location_id,
      apiKey: parsed.data.api_key,
      pipelineId: parsed.data.pipeline_id,
      defaultStageId: parsed.data.default_stage_id,
      enabled: parsed.data.enabled,
    });

    return c.json({ crm_config: formatCrmConfig(crmConfig) }, 201);
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

crmRoutes.patch('/:slugOrId/crm-config', async (c) => {
  const parsed = await parseJsonBody(c, crmConfigPatchSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    const existing = await getTenantCrmConfig(details.tenant.id);

    if (!existing && (!parsed.data.location_id || !parsed.data.api_key)) {
      return c.json({ error: 'invalid_request', message: 'location_id and api_key are required' }, 400);
    }

    const crmConfig = await upsertTenantCrmConfig({
      tenantId: details.tenant.id,
      locationId: parsed.data.location_id ?? existing?.location_id ?? '',
      apiKey: parsed.data.api_key,
      apiKeyEncrypted: existing?.api_key_encrypted,
      pipelineId: parsed.data.pipeline_id ?? existing?.pipeline_id ?? null,
      defaultStageId: parsed.data.default_stage_id ?? existing?.default_stage_id ?? null,
      enabled: parsed.data.enabled ?? existing?.enabled ?? true,
    });

    return c.json({ crm_config: formatCrmConfig(crmConfig) });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

crmRoutes.post('/:slugOrId/crm-config/test', async (c) => {
  try {
    const details = await getTenantBySlugOrId(c.req.param('slugOrId'));

    if (!details) {
      return c.json({ error: 'not_found' }, 404);
    }

    const crm = await resolveCrmConnector(details.tenant.id);

    if (!crm) {
      return c.json({ error: 'not_configured' }, 400);
    }

    const contact = await crm.connector.upsertContact({
      phone: '+15555550199',
      name: 'AI Receptionist CRM Test',
      tags: ['ai-receptionist-test'],
    });
    const note = await crm.connector.appendNote({
      contactId: contact.contactId,
      body: `CRM connector test for ${details.tenant.name} at ${new Date().toISOString()}`,
    });

    return c.json({
      ok: true,
      provider: crm.config.provider,
      contact_id: contact.contactId,
      note_id: note.noteId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown CRM test failure';
    return c.json({ ok: false, error: 'crm_test_failed', diagnostic: message }, 400);
  }
});

function formatCrmConfig(row: TenantCrmConfigRow) {
  return {
    tenant_id: row.tenant_id,
    provider: row.provider,
    location_id: row.location_id,
    api_key: maskEncryptedCredential(row.api_key_encrypted),
    pipeline_id: row.pipeline_id,
    default_stage_id: row.default_stage_id,
    enabled: row.enabled,
    updated_at: row.updated_at,
  };
}
