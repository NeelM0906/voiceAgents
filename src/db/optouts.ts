import { supabase } from './client.js';
import type { ConsumerOptoutReason, ConsumerOptoutRow } from './types.js';

export async function upsertConsumerOptout(input: {
  tenantId: string;
  contactPhone: string;
  reason?: ConsumerOptoutReason;
}): Promise<ConsumerOptoutRow> {
  const { data, error } = await supabase
    .from('consumer_optouts')
    .upsert(
      {
        tenant_id: input.tenantId,
        contact_phone: input.contactPhone,
        reason: input.reason ?? 'stop_keyword',
        created_at: new Date().toISOString(),
      },
      {
        onConflict: 'tenant_id,contact_phone',
      },
    )
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function deleteConsumerOptout(input: {
  tenantId: string;
  contactPhone: string;
}): Promise<void> {
  const { error } = await supabase
    .from('consumer_optouts')
    .delete()
    .eq('tenant_id', input.tenantId)
    .eq('contact_phone', input.contactPhone);

  if (error) {
    throw error;
  }
}

export async function isConsumerOptedOut(input: {
  tenantId: string;
  contactPhone: string;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from('consumer_optouts')
    .select('tenant_id')
    .eq('tenant_id', input.tenantId)
    .eq('contact_phone', input.contactPhone)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}
