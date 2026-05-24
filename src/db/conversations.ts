import { supabase } from './client.js';
import { DbConflictError, DbNotFoundError } from './tenants.js';
import type { ConversationRow } from './types.js';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export type ConversationListItem = ConversationRow & {
  message_count: number;
};

export async function getOrCreateConversationByContact(input: {
  tenantId: string;
  contactPhone: string;
}): Promise<ConversationRow> {
  const existing = await getConversationByContact(input);

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      tenant_id: input.tenantId,
      contact_phone: input.contactPhone,
    })
    .select('*')
    .single();

  if (!error) {
    return data;
  }

  if (error.code !== POSTGRES_UNIQUE_VIOLATION) {
    throw error;
  }

  const racedExisting = await getConversationByContact(input);

  if (!racedExisting) {
    throw new DbConflictError(
      `Conversation already exists for tenant/contact: ${input.tenantId}/${input.contactPhone}`,
    );
  }

  return racedExisting;
}

export async function getConversationByContact(input: {
  tenantId: string;
  contactPhone: string;
}): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('contact_phone', input.contactPhone)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function getConversation(input: {
  tenantId: string;
  conversationId: string;
}): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.conversationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function listConversationsForTenant(input: {
  tenantId: string;
  contactPhone?: string;
  limit: number;
  beforeCursor?: string;
}): Promise<ConversationListItem[]> {
  let query = supabase
    .from('conversations')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .order('last_message_at', { ascending: false })
    .limit(input.limit);

  if (input.contactPhone) {
    query = query.eq('contact_phone', input.contactPhone);
  }

  if (input.beforeCursor) {
    query = query.lt('last_message_at', input.beforeCursor);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const conversations = data ?? [];
  const messageCounts = await Promise.all(
    conversations.map(async (conversation) => {
      const { count, error: countError } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversation.id);

      if (countError) {
        throw countError;
      }

      return count ?? 0;
    }),
  );

  return conversations.map((conversation, index) => ({
    ...conversation,
    message_count: messageCounts[index] ?? 0,
  }));
}

export async function bumpConversationLastMessageAt(input: {
  tenantId: string;
  conversationId: string;
  lastMessageAt?: string;
}): Promise<ConversationRow> {
  const { data, error } = await supabase
    .from('conversations')
    .update({
      last_message_at: input.lastMessageAt ?? new Date().toISOString(),
    })
    .eq('tenant_id', input.tenantId)
    .eq('id', input.conversationId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new DbNotFoundError(`Conversation not found: ${input.conversationId}`);
  }

  return data;
}

export async function updateConversationCrmSync(input: {
  tenantId: string;
  conversationId: string;
  crmContactId: string;
}): Promise<ConversationRow> {
  const { data, error } = await supabase
    .from('conversations')
    .update({
      crm_contact_id: input.crmContactId,
      crm_last_synced_at: new Date().toISOString(),
    })
    .eq('tenant_id', input.tenantId)
    .eq('id', input.conversationId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new DbNotFoundError(`Conversation not found: ${input.conversationId}`);
  }

  return data;
}
