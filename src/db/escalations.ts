import { supabase } from './client.js';
import type { EscalationInsert, EscalationRow, EscalationSource } from './types.js';

export async function insertEscalation(input: {
  tenantId: string;
  source: EscalationSource;
  reason: string;
  contactPhone?: string | null;
  conversationId?: string | null;
  callId?: string | null;
}): Promise<EscalationRow> {
  const insert: EscalationInsert = {
    tenant_id: input.tenantId,
    source: input.source,
    reason: input.reason,
    contact_phone: input.contactPhone ?? null,
    conversation_id: input.conversationId ?? null,
    call_id: input.callId ?? null,
  };

  const { data, error } = await supabase.from('escalations').insert(insert).select('*').single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateEscalationOwnerNotification(input: {
  escalationId: string;
  ownerNotifiedAt: string | null;
  ownerMessageSid: string | null;
}): Promise<EscalationRow> {
  const { data, error } = await supabase
    .from('escalations')
    .update({
      owner_notified_at: input.ownerNotifiedAt,
      owner_message_sid: input.ownerMessageSid,
    })
    .eq('id', input.escalationId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function listEscalationsForConversation(input: {
  tenantId: string;
  conversationId: string;
}): Promise<EscalationRow[]> {
  const { data, error } = await supabase
    .from('escalations')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}
