import { supabase } from './client.js';
import type { ReviewRequestRow, ReviewRequestStatus } from './types.js';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export async function getReviewRequestByCallId(callId: string): Promise<ReviewRequestRow | null> {
  const { data, error } = await supabase
    .from('review_requests')
    .select('*')
    .eq('call_id', callId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function insertReviewRequest(input: {
  tenantId: string;
  callId: string;
  contactPhone: string;
  status: ReviewRequestStatus;
  skippedReason?: string | null;
}): Promise<{ row: ReviewRequestRow; inserted: boolean }> {
  const { data, error } = await supabase
    .from('review_requests')
    .insert({
      tenant_id: input.tenantId,
      call_id: input.callId,
      contact_phone: input.contactPhone,
      status: input.status,
      skipped_reason: input.skippedReason ?? null,
    })
    .select('*')
    .single();

  if (!error) {
    return {
      row: data,
      inserted: true,
    };
  }

  if (error.code !== POSTGRES_UNIQUE_VIOLATION) {
    throw error;
  }

  const existing = await getReviewRequestByCallId(input.callId);

  if (!existing) {
    throw error;
  }

  return {
    row: existing,
    inserted: false,
  };
}

export async function updateReviewRequest(input: {
  id: string;
  status: ReviewRequestStatus;
  skippedReason?: string | null;
  messageSid?: string | null;
}): Promise<ReviewRequestRow> {
  const { data, error } = await supabase
    .from('review_requests')
    .update({
      status: input.status,
      skipped_reason: input.skippedReason ?? null,
      message_sid: input.messageSid ?? null,
    })
    .eq('id', input.id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}
