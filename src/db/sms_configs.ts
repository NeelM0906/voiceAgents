import { supabase } from './client.js';
import { DbConflictError, DbNotFoundError } from './tenants.js';
import type { TenantSmsConfigInsert, TenantSmsConfigRow, TenantSmsConfigUpdate } from './types.js';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export async function getSmsConfig(tenantId: string): Promise<TenantSmsConfigRow | null> {
  const { data, error } = await supabase
    .from('tenant_sms_configs')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function createSmsConfig(input: TenantSmsConfigInsert): Promise<TenantSmsConfigRow> {
  const { data, error } = await supabase
    .from('tenant_sms_configs')
    .insert(input)
    .select('*')
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      throw new DbConflictError(`SMS config already exists for tenant: ${input.tenant_id}`);
    }

    throw error;
  }

  return data;
}

export async function upsertSmsConfig(input: TenantSmsConfigInsert): Promise<TenantSmsConfigRow> {
  const { data, error } = await supabase
    .from('tenant_sms_configs')
    .upsert(input, { onConflict: 'tenant_id' })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function patchSmsConfig(input: {
  tenantId: string;
  updates: TenantSmsConfigUpdate;
}): Promise<TenantSmsConfigRow> {
  const { data, error } = await supabase
    .from('tenant_sms_configs')
    .update(input.updates)
    .eq('tenant_id', input.tenantId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new DbNotFoundError(`SMS config not found for tenant: ${input.tenantId}`);
  }

  return data;
}
