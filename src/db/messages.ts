import { supabase } from './client.js';
import type { Json, MessageChannel, MessageInsert, MessageRole, MessageRow } from './types.js';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export type InsertMessageInput = {
  conversationId: string;
  tenantId: string;
  channel: MessageChannel;
  role: MessageRole;
  content: string;
  callId?: string | null;
  externalId?: string | null;
  metadata?: Json;
};

export type InsertMessageOnceResult = {
  message: MessageRow;
  inserted: boolean;
};

export async function insertMessage(input: InsertMessageInput): Promise<MessageRow> {
  const { data, error } = await supabase
    .from('messages')
    .insert(toMessageInsert(input))
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function insertMessageOnceByExternalId(
  input: InsertMessageInput & { externalId: string },
): Promise<InsertMessageOnceResult> {
  const { data, error } = await supabase
    .from('messages')
    .insert(toMessageInsert(input))
    .select('*')
    .single();

  if (!error) {
    return {
      message: data,
      inserted: true,
    };
  }

  if (error.code !== POSTGRES_UNIQUE_VIOLATION) {
    throw error;
  }

  const existing = await getMessageByExternalId(input.externalId);

  if (!existing) {
    throw error;
  }

  return {
    message: existing,
    inserted: false,
  };
}

export async function getMessageByExternalId(externalId: string): Promise<MessageRow | null> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('external_id', externalId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function listMessagesByConversation(input: {
  tenantId: string;
  conversationId: string;
  limit: number;
  beforeCursor?: string;
}): Promise<{ messages: MessageRow[]; nextCursor: string | null }> {
  let query = supabase
    .from('messages')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false })
    .limit(input.limit + 1);

  if (input.beforeCursor) {
    query = query.lt('created_at', input.beforeCursor);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const chronological = [...page].reverse();

  return {
    messages: chronological,
    nextCursor: hasMore ? page[page.length - 1]?.created_at ?? null : null,
  };
}

export async function listAllMessagesByConversation(input: {
  tenantId: string;
  conversationId: string;
  limit?: number;
}): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: true })
    .limit(input.limit ?? 200);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function recentMessagesForContext(input: {
  tenantId: string;
  conversationId: string;
  limit: number;
}): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false })
    .limit(input.limit);

  if (error) {
    throw error;
  }

  return [...(data ?? [])].reverse();
}

export async function listMessagesForCall(input: {
  tenantId: string;
  callId: string;
}): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('call_id', input.callId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

function toMessageInsert(input: InsertMessageInput): MessageInsert {
  return {
    conversation_id: input.conversationId,
    tenant_id: input.tenantId,
    channel: input.channel,
    role: input.role,
    content: input.content,
    call_id: input.callId ?? null,
    external_id: input.externalId ?? null,
    metadata: input.metadata ?? {},
  };
}
