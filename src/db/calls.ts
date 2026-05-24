import { supabase } from './client.js';
import type { CallInsert, CallRow, CallStatus, Json } from './types.js';

export async function insertCall(input: {
  tenant_id?: string | null;
  sip_call_id?: string | null;
  livekit_room_name: string;
  caller_number?: string | null;
  called_number: string;
  status?: CallStatus;
  ended_at?: string | null;
  metadata?: Json;
}): Promise<CallRow> {
  const insert: CallInsert = {
    tenant_id: input.tenant_id ?? null,
    sip_call_id: input.sip_call_id ?? null,
    livekit_room_name: input.livekit_room_name,
    caller_number: input.caller_number ?? null,
    called_number: input.called_number,
    status: input.status ?? 'in_progress',
    ended_at: input.ended_at ?? null,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await supabase.from('calls').insert(insert).select('*').single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateCallEnded(callId: string, status: CallStatus): Promise<CallRow> {
  const { data, error } = await supabase
    .from('calls')
    .update({
      status,
      ended_at: new Date().toISOString(),
    })
    .eq('id', callId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function getCallById(input: {
  tenantId: string;
  callId: string;
}): Promise<CallRow | null> {
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.callId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateCallSummary(input: {
  tenantId: string;
  callId: string;
  summary: string | null;
  keyFacts: Json | null;
  outcome: string;
}): Promise<CallRow> {
  const { data, error } = await supabase
    .from('calls')
    .update({
      summary: input.summary,
      key_facts: input.keyFacts,
      outcome: input.outcome,
    })
    .eq('tenant_id', input.tenantId)
    .eq('id', input.callId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}
