import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { supabase } from '../db/client.js';
import type { TenantCrmConfigRow } from '../db/types.js';
import { GhlConnector } from './ghl.js';
import type { CrmConnector } from './types.js';

const ENCRYPTION_PREFIX = 'v1';

export async function resolveCrmConnector(tenantId: string): Promise<{
  config: TenantCrmConfigRow;
  connector: CrmConnector;
} | null> {
  if (!config.CRM_SYNC_ENABLED) {
    return null;
  }

  const crmConfig = await getTenantCrmConfig(tenantId);

  if (!crmConfig?.enabled) {
    return null;
  }

  const apiKey = decryptCredential(crmConfig.api_key_encrypted);

  return {
    config: crmConfig,
    connector: new GhlConnector(crmConfig, apiKey),
  };
}

export async function getTenantCrmConfig(tenantId: string): Promise<TenantCrmConfigRow | null> {
  const { data, error } = await supabase
    .from('tenant_crm_configs')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function upsertTenantCrmConfig(input: {
  tenantId: string;
  locationId: string;
  apiKey?: string;
  apiKeyEncrypted?: string;
  pipelineId?: string | null;
  defaultStageId?: string | null;
  enabled?: boolean;
}): Promise<TenantCrmConfigRow> {
  const existing = await getTenantCrmConfig(input.tenantId);
  const apiKeyEncrypted =
    input.apiKey !== undefined
      ? encryptCredential(input.apiKey)
      : input.apiKeyEncrypted ?? existing?.api_key_encrypted;

  if (!apiKeyEncrypted) {
    throw new Error('api_key is required');
  }

  const { data, error } = await supabase
    .from('tenant_crm_configs')
    .upsert(
      {
        tenant_id: input.tenantId,
        provider: 'ghl',
        location_id: input.locationId,
        api_key_encrypted: apiKeyEncrypted,
        pipeline_id: input.pipelineId ?? null,
        default_stage_id: input.defaultStageId ?? null,
        enabled: input.enabled ?? true,
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

  return data;
}

export function encryptCredential(plaintext: string): string {
  const key = credentialKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptCredential(encrypted: string): string {
  const [version, ivText, tagText, ciphertextText] = encrypted.split(':');

  if (version !== ENCRYPTION_PREFIX || !ivText || !tagText || !ciphertextText) {
    throw new Error('Unsupported encrypted credential format');
  }

  const key = credentialKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskEncryptedCredential(encrypted: string): string {
  try {
    const plaintext = decryptCredential(encrypted);
    const suffix = plaintext.slice(-4);
    return `****${suffix}`;
  } catch {
    return '****';
  }
}

function credentialKey(): Buffer {
  if (!config.CRM_CREDENTIAL_KEY) {
    throw new Error('CRM_CREDENTIAL_KEY is required for CRM credential encryption');
  }

  const key = Buffer.from(config.CRM_CREDENTIAL_KEY, 'base64');

  if (key.length !== 32) {
    throw new Error('CRM_CREDENTIAL_KEY must be a 32-byte base64 encoded key');
  }

  return key;
}
