import { supabase } from './client.js';
import type {
  TenantDetails,
  TenantPhoneNumberRow,
  TenantRow,
  TenantStatus,
  TenantVoiceConfigInsert,
  TenantVoiceConfigRow,
  TenantVoiceConfigUpdate,
  TenantWithVoiceConfig,
} from './types.js';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export class DbConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbConflictError';
  }
}

export class DbNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbNotFoundError';
  }
}

type PhoneTenantJoin = {
  phone_number: string;
  tenant: (TenantRow & {
    voice_config: TenantVoiceConfigRow | TenantVoiceConfigRow[] | null;
  }) | null;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeVoiceConfig(
  voiceConfig: TenantVoiceConfigRow | TenantVoiceConfigRow[] | null,
): TenantVoiceConfigRow | null {
  if (Array.isArray(voiceConfig)) {
    return voiceConfig[0] ?? null;
  }

  return voiceConfig;
}

export async function getTenantByPhoneNumber(
  phoneNumber: string,
): Promise<TenantWithVoiceConfig | null> {
  const { data, error } = await supabase
    .from('tenant_phone_numbers')
    .select(
      `
        phone_number,
        tenant:tenants!tenant_phone_numbers_tenant_id_fkey (
          *,
          voice_config:tenant_voice_configs!tenant_voice_configs_tenant_id_fkey (*)
        )
      `,
    )
    .eq('phone_number', phoneNumber)
    .maybeSingle()
    .returns<PhoneTenantJoin>();

  if (error) {
    throw error;
  }

  if (!data?.tenant) {
    return null;
  }

  const voiceConfig = normalizeVoiceConfig(data.tenant.voice_config);

  if (!voiceConfig) {
    return null;
  }

  const { voice_config: _voiceConfig, ...tenant } = data.tenant;

  return {
    tenant,
    voice_config: voiceConfig,
  };
}

export async function getTenantBySlug(slug: string): Promise<TenantDetails | null> {
  return getTenantDetails('slug', slug);
}

export async function getTenantBySlugOrId(slugOrId: string): Promise<TenantDetails | null> {
  return getTenantDetails(isUuid(slugOrId) ? 'id' : 'slug', slugOrId);
}

async function getTenantDetails(field: 'id' | 'slug', value: string): Promise<TenantDetails | null> {
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq(field, value)
    .maybeSingle();

  if (tenantError) {
    throw tenantError;
  }

  if (!tenant) {
    return null;
  }

  const [{ data: voiceConfig, error: voiceConfigError }, { data: phoneRows, error: phoneError }] =
    await Promise.all([
      supabase
        .from('tenant_voice_configs')
        .select('*')
        .eq('tenant_id', tenant.id)
        .maybeSingle(),
      supabase
        .from('tenant_phone_numbers')
        .select('phone_number')
        .eq('tenant_id', tenant.id)
        .order('phone_number', { ascending: true }),
    ]);

  if (voiceConfigError) {
    throw voiceConfigError;
  }

  if (phoneError) {
    throw phoneError;
  }

  if (!voiceConfig) {
    return null;
  }

  return {
    tenant,
    voice_config: voiceConfig,
    phone_numbers: (phoneRows ?? []).map((row) => row.phone_number),
  };
}

export async function createTenant(input: {
  slug: string;
  name: string;
  voice_config: Omit<TenantVoiceConfigInsert, 'tenant_id'>;
}): Promise<TenantWithVoiceConfig> {
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({ slug: input.slug, name: input.name })
    .select('*')
    .single();

  if (tenantError) {
    if (tenantError.code === POSTGRES_UNIQUE_VIOLATION) {
      throw new DbConflictError(`Tenant slug already exists: ${input.slug}`);
    }

    throw tenantError;
  }

  const { data: voiceConfig, error: voiceConfigError } = await supabase
    .from('tenant_voice_configs')
    .insert({
      ...input.voice_config,
      tenant_id: tenant.id,
    })
    .select('*')
    .single();

  if (voiceConfigError) {
    await supabase.from('tenants').delete().eq('id', tenant.id);
    throw voiceConfigError;
  }

  return {
    tenant,
    voice_config: voiceConfig,
  };
}

export async function updateVoiceConfig(
  slugOrId: string,
  updates: TenantVoiceConfigUpdate,
): Promise<TenantVoiceConfigRow> {
  const details = await getTenantBySlugOrId(slugOrId);

  if (!details) {
    throw new DbNotFoundError(`Tenant not found: ${slugOrId}`);
  }

  const { data, error } = await supabase
    .from('tenant_voice_configs')
    .update(updates)
    .eq('tenant_id', details.tenant.id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function addPhoneNumber(
  slugOrId: string,
  phoneNumber: string,
): Promise<TenantPhoneNumberRow> {
  const details = await getTenantBySlugOrId(slugOrId);

  if (!details) {
    throw new DbNotFoundError(`Tenant not found: ${slugOrId}`);
  }

  const { data, error } = await supabase
    .from('tenant_phone_numbers')
    .insert({
      phone_number: phoneNumber,
      tenant_id: details.tenant.id,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      throw new DbConflictError(`Phone number already exists: ${phoneNumber}`);
    }

    throw error;
  }

  return data;
}

export async function removePhoneNumber(slugOrId: string, phoneNumber: string): Promise<void> {
  const details = await getTenantBySlugOrId(slugOrId);

  if (!details) {
    throw new DbNotFoundError(`Tenant not found: ${slugOrId}`);
  }

  const { data, error } = await supabase
    .from('tenant_phone_numbers')
    .delete()
    .eq('tenant_id', details.tenant.id)
    .eq('phone_number', phoneNumber)
    .select('phone_number');

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    throw new DbNotFoundError(`Phone number not found: ${phoneNumber}`);
  }
}

export async function updateTenantStatus(
  slugOrId: string,
  status: TenantStatus,
): Promise<TenantRow> {
  const details = await getTenantBySlugOrId(slugOrId);

  if (!details) {
    throw new DbNotFoundError(`Tenant not found: ${slugOrId}`);
  }

  const { data, error } = await supabase
    .from('tenants')
    .update({ status })
    .eq('id', details.tenant.id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}
