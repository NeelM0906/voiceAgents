import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { supabase } from '../db/client.js';
import { getTenantBySlugOrId } from '../db/tenants.js';
import { handleAdminRouteError, parseJsonBody } from './admin-utils.js';

const nullableText = z.string().trim().min(1).nullable();
const e164Nullable = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{1,14}$/, 'must be E.164, for example +15551234567')
  .nullable();

const ownerConfigSchema = z.object({
  owner_name: nullableText.optional(),
  owner_phone: e164Nullable.optional(),
  notify_on_emergency: z.boolean().optional(),
  notify_on_missed_call: z.boolean().optional(),
});

const reviewConfigCreateSchema = z.object({
  enabled: z.boolean().default(false),
  review_link: z.string().trim().url(),
  template: z.string().trim().min(1).max(1000),
  delay_seconds: z.number().int().min(0).max(86400).default(1800),
  send_after_call_min_duration_seconds: z.number().int().min(0).default(60),
});

const reviewConfigPatchSchema = reviewConfigCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'at least one review config field is required',
);

export const tenantSettingsRoutes = new Hono();

tenantSettingsRoutes.get('/:slugOrId/owner-config', async (c) => {
  try {
    const tenant = await resolveTenant(String(c.req.param('slugOrId')));

    if (!tenant) {
      return c.json({ error: 'not_found' }, 404);
    }

    const { data, error } = await supabase
      .from('tenant_owner_configs')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return c.json({ owner_config: data });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

tenantSettingsRoutes.post('/:slugOrId/owner-config', async (c) => {
  return upsertOwnerConfig(c);
});

tenantSettingsRoutes.patch('/:slugOrId/owner-config', async (c) => {
  return upsertOwnerConfig(c);
});

tenantSettingsRoutes.get('/:slugOrId/review-config', async (c) => {
  try {
    const tenant = await resolveTenant(String(c.req.param('slugOrId')));

    if (!tenant) {
      return c.json({ error: 'not_found' }, 404);
    }

    const { data, error } = await supabase
      .from('tenant_review_configs')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return c.json({ review_config: data });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

tenantSettingsRoutes.post('/:slugOrId/review-config', async (c) => {
  const parsed = await parseJsonBody(c, reviewConfigCreateSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  return upsertReviewConfig(c, parsed.data);
});

tenantSettingsRoutes.patch('/:slugOrId/review-config', async (c) => {
  const parsed = await parseJsonBody(c, reviewConfigPatchSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  return upsertReviewConfig(c, parsed.data);
});

tenantSettingsRoutes.get('/:slugOrId/escalations', async (c) => {
  try {
    const tenant = await resolveTenant(c.req.param('slugOrId') ?? '');

    if (!tenant) {
      return c.json({ error: 'not_found' }, 404);
    }

    const { data, error } = await supabase
      .from('escalations')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(parseLimit(c.req.query('limit'), 50, 200));

    if (error) {
      throw error;
    }

    return c.json({ escalations: data ?? [] });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

tenantSettingsRoutes.get('/:slugOrId/dashboard', async (c) => {
  try {
    const tenant = await resolveTenant(c.req.param('slugOrId') ?? '');

    if (!tenant) {
      return c.json({ error: 'not_found' }, 404);
    }

    const now = Date.now();
    const last24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [day, week, reviewRequestsSent, optOuts, crmSyncedContacts] = await Promise.all([
      aggregateWindow(tenant.id, last24h),
      aggregateWindow(tenant.id, last7d),
      countRows('review_requests', tenant.id, { column: 'status', value: 'sent' }),
      countRows('consumer_optouts', tenant.id),
      countRows('conversations', tenant.id, { column: 'crm_contact_id', value: 'not_null' }),
    ]);

    return c.json({
      last_24h: day,
      last_7d: week,
      review_requests_sent: reviewRequestsSent,
      opt_outs: optOuts,
      crm_synced_contacts: crmSyncedContacts,
    });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

async function upsertOwnerConfig(c: Context): Promise<Response> {
  const parsed = await parseJsonBody(c, ownerConfigSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const tenant = await resolveTenant(c.req.param('slugOrId') ?? '');

    if (!tenant) {
      return c.json({ error: 'not_found' }, 404);
    }

    const { data: existing, error: existingError } = await supabase
      .from('tenant_owner_configs')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    const { data, error } = await supabase
      .from('tenant_owner_configs')
      .upsert(
        {
          tenant_id: tenant.id,
          owner_name: parsed.data.owner_name ?? existing?.owner_name ?? null,
          owner_phone: parsed.data.owner_phone ?? existing?.owner_phone ?? null,
          notify_on_emergency: parsed.data.notify_on_emergency ?? existing?.notify_on_emergency ?? true,
          notify_on_missed_call:
            parsed.data.notify_on_missed_call ?? existing?.notify_on_missed_call ?? false,
        },
        {
          onConflict: 'tenant_id',
        },
      )
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return c.json({ owner_config: data });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
}

async function upsertReviewConfig(
  c: Context,
  updates: z.output<typeof reviewConfigPatchSchema>,
): Promise<Response> {
  try {
    const tenant = await resolveTenant(c.req.param('slugOrId') ?? '');

    if (!tenant) {
      return c.json({ error: 'not_found' }, 404);
    }

    const { data: existing, error: existingError } = await supabase
      .from('tenant_review_configs')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (!existing && (!updates.review_link || !updates.template)) {
      return c.json({ error: 'invalid_request', message: 'review_link and template are required' }, 400);
    }

    const { data, error } = await supabase
      .from('tenant_review_configs')
      .upsert(
        {
          tenant_id: tenant.id,
          enabled: updates.enabled ?? existing?.enabled ?? false,
          review_link: updates.review_link ?? existing?.review_link ?? '',
          template: updates.template ?? existing?.template ?? '',
          delay_seconds: updates.delay_seconds ?? existing?.delay_seconds ?? 1800,
          send_after_call_min_duration_seconds:
            updates.send_after_call_min_duration_seconds ??
            existing?.send_after_call_min_duration_seconds ??
            60,
        },
        {
          onConflict: 'tenant_id',
        },
      )
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return c.json({ review_config: data });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
}

async function resolveTenant(slugOrId: string) {
  const details = await getTenantBySlugOrId(slugOrId);
  return details?.tenant ?? null;
}

async function aggregateWindow(tenantId: string, since: string) {
  const [calls, smsInbound, smsOutbound, escalations] = await Promise.all([
    countRows('calls', tenantId, { column: 'started_at', gte: since }),
    countRows('messages', tenantId, { column: 'created_at', gte: since, role: 'user' }),
    countRows('messages', tenantId, { column: 'created_at', gte: since, role: 'assistant' }),
    countRows('escalations', tenantId, { column: 'created_at', gte: since }),
  ]);

  return {
    calls,
    sms_inbound: smsInbound,
    sms_outbound: smsOutbound,
    escalations,
  };
}

async function countRows(
  table: 'calls' | 'messages' | 'escalations' | 'review_requests' | 'consumer_optouts' | 'conversations',
  tenantId: string,
  filter?: {
    column: string;
    value?: string;
    gte?: string;
    role?: 'user' | 'assistant';
  },
): Promise<number> {
  let query: any = supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  if (filter?.gte) {
    query = query.gte(filter.column, filter.gte);
  }

  if (filter?.value && filter.value !== 'not_null') {
    query = query.eq(filter.column, filter.value);
  }

  if (filter?.value === 'not_null') {
    query = query.not(filter.column, 'is', null);
  }

  if (filter?.role) {
    query = query.eq('channel', 'sms').eq('role', filter.role);
  }

  const { count, error } = await query;

  if (error) {
    throw error;
  }

  return count ?? 0;
}

function parseLimit(value: string | undefined, defaultValue: number, maxValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxValue) {
    return defaultValue;
  }

  return parsed;
}
