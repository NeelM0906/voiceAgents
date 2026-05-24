export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type TenantStatus = 'active' | 'paused';
export type CallStatus = 'in_progress' | 'completed' | 'failed' | 'rejected_no_tenant';
export type MessageChannel = 'sms' | 'voice';
export type MessageRole = 'user' | 'assistant' | 'system';
export type RagPipelineName = 'hybrid' | 'page_index';
export type EvalQuerySource = 'synthetic' | 'human';
export type ConsumerOptoutReason = 'stop_keyword' | 'manual' | 'complaint';
export type CrmProvider = 'ghl';
export type ReviewRequestStatus = 'queued' | 'sent' | 'skipped' | 'failed';
export type EscalationSource = 'voice' | 'sms';

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
};

export type TenantInsert = {
  id?: string;
  slug: string;
  name: string;
  status?: TenantStatus;
  created_at?: string;
  updated_at?: string;
};

export type TenantUpdate = {
  slug?: string;
  name?: string;
  status?: TenantStatus;
  created_at?: string;
  updated_at?: string;
};

export type TenantPhoneNumberRow = {
  phone_number: string;
  tenant_id: string;
  provider: string;
  created_at: string;
};

export type TenantPhoneNumberInsert = {
  phone_number: string;
  tenant_id: string;
  provider?: string;
  created_at?: string;
};

export type TenantVoiceConfigRow = {
  tenant_id: string;
  business_name: string;
  first_message: string;
  system_prompt: string;
  voice: string;
  model: string;
  updated_at: string;
};

export type TenantVoiceConfigInsert = {
  tenant_id: string;
  business_name: string;
  first_message: string;
  system_prompt: string;
  voice?: string;
  model?: string;
  updated_at?: string;
};

export type TenantVoiceConfigUpdate = {
  business_name?: string;
  first_message?: string;
  system_prompt?: string;
  voice?: string;
  model?: string;
  updated_at?: string;
};

export type TenantSmsConfigRow = {
  tenant_id: string;
  system_prompt: string;
  model: string;
  follow_up_sms_template: string | null;
  follow_up_delay_seconds: number;
  updated_at: string;
};

export type TenantSmsConfigInsert = {
  tenant_id: string;
  system_prompt: string;
  model?: string;
  follow_up_sms_template?: string | null;
  follow_up_delay_seconds?: number;
  updated_at?: string;
};

export type TenantSmsConfigUpdate = {
  system_prompt?: string;
  model?: string;
  follow_up_sms_template?: string | null;
  follow_up_delay_seconds?: number;
  updated_at?: string;
};

export type CallRow = {
  id: string;
  tenant_id: string | null;
  sip_call_id: string | null;
  livekit_room_name: string;
  caller_number: string | null;
  called_number: string;
  started_at: string;
  ended_at: string | null;
  status: CallStatus;
  metadata: Json;
  summary: string | null;
  key_facts: Json | null;
  outcome: string | null;
};

export type CallInsert = {
  id?: string;
  tenant_id?: string | null;
  sip_call_id?: string | null;
  livekit_room_name: string;
  caller_number?: string | null;
  called_number: string;
  started_at?: string;
  ended_at?: string | null;
  status?: CallStatus;
  metadata?: Json;
  summary?: string | null;
  key_facts?: Json | null;
  outcome?: string | null;
};

export type CallUpdate = {
  tenant_id?: string | null;
  sip_call_id?: string | null;
  livekit_room_name?: string;
  caller_number?: string | null;
  called_number?: string;
  started_at?: string;
  ended_at?: string | null;
  status?: CallStatus;
  metadata?: Json;
  summary?: string | null;
  key_facts?: Json | null;
  outcome?: string | null;
};

export type ConversationRow = {
  id: string;
  tenant_id: string;
  contact_phone: string;
  last_message_at: string;
  created_at: string;
  crm_contact_id: string | null;
  crm_last_synced_at: string | null;
};

export type ConversationInsert = {
  id?: string;
  tenant_id: string;
  contact_phone: string;
  last_message_at?: string;
  created_at?: string;
  crm_contact_id?: string | null;
  crm_last_synced_at?: string | null;
};

export type ConversationUpdate = {
  contact_phone?: string;
  last_message_at?: string;
  created_at?: string;
  crm_contact_id?: string | null;
  crm_last_synced_at?: string | null;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  tenant_id: string;
  channel: MessageChannel;
  role: MessageRole;
  content: string;
  call_id: string | null;
  external_id: string | null;
  metadata: Json;
  created_at: string;
};

export type MessageInsert = {
  id?: string;
  conversation_id: string;
  tenant_id: string;
  channel: MessageChannel;
  role: MessageRole;
  content: string;
  call_id?: string | null;
  external_id?: string | null;
  metadata?: Json;
  created_at?: string;
};

export type MessageUpdate = {
  content?: string;
  metadata?: Json;
};

export type ConsumerOptoutRow = {
  tenant_id: string;
  contact_phone: string;
  reason: ConsumerOptoutReason;
  created_at: string;
};

export type ConsumerOptoutInsert = {
  tenant_id: string;
  contact_phone: string;
  reason?: ConsumerOptoutReason;
  created_at?: string;
};

export type ConsumerOptoutUpdate = {
  reason?: ConsumerOptoutReason;
  created_at?: string;
};

export type TenantOwnerConfigRow = {
  tenant_id: string;
  owner_name: string | null;
  owner_phone: string | null;
  notify_on_emergency: boolean;
  notify_on_missed_call: boolean;
  updated_at: string;
};

export type TenantOwnerConfigInsert = {
  tenant_id: string;
  owner_name?: string | null;
  owner_phone?: string | null;
  notify_on_emergency?: boolean;
  notify_on_missed_call?: boolean;
  updated_at?: string;
};

export type TenantOwnerConfigUpdate = {
  owner_name?: string | null;
  owner_phone?: string | null;
  notify_on_emergency?: boolean;
  notify_on_missed_call?: boolean;
  updated_at?: string;
};

export type TenantReviewConfigRow = {
  tenant_id: string;
  enabled: boolean;
  review_link: string;
  template: string;
  delay_seconds: number;
  send_after_call_min_duration_seconds: number;
  updated_at: string;
};

export type TenantReviewConfigInsert = {
  tenant_id: string;
  enabled?: boolean;
  review_link: string;
  template: string;
  delay_seconds?: number;
  send_after_call_min_duration_seconds?: number;
  updated_at?: string;
};

export type TenantReviewConfigUpdate = {
  enabled?: boolean;
  review_link?: string;
  template?: string;
  delay_seconds?: number;
  send_after_call_min_duration_seconds?: number;
  updated_at?: string;
};

export type TenantCrmConfigRow = {
  tenant_id: string;
  provider: CrmProvider;
  location_id: string;
  api_key_encrypted: string;
  pipeline_id: string | null;
  default_stage_id: string | null;
  enabled: boolean;
  updated_at: string;
};

export type TenantCrmConfigInsert = {
  tenant_id: string;
  provider: CrmProvider;
  location_id: string;
  api_key_encrypted: string;
  pipeline_id?: string | null;
  default_stage_id?: string | null;
  enabled?: boolean;
  updated_at?: string;
};

export type TenantCrmConfigUpdate = {
  provider?: CrmProvider;
  location_id?: string;
  api_key_encrypted?: string;
  pipeline_id?: string | null;
  default_stage_id?: string | null;
  enabled?: boolean;
  updated_at?: string;
};

export type ReviewRequestRow = {
  id: string;
  tenant_id: string;
  call_id: string;
  contact_phone: string;
  status: ReviewRequestStatus;
  skipped_reason: string | null;
  message_sid: string | null;
  created_at: string;
};

export type ReviewRequestInsert = {
  id?: string;
  tenant_id: string;
  call_id: string;
  contact_phone: string;
  status: ReviewRequestStatus;
  skipped_reason?: string | null;
  message_sid?: string | null;
  created_at?: string;
};

export type ReviewRequestUpdate = {
  status?: ReviewRequestStatus;
  skipped_reason?: string | null;
  message_sid?: string | null;
};

export type EscalationRow = {
  id: string;
  tenant_id: string;
  call_id: string | null;
  conversation_id: string | null;
  source: EscalationSource;
  reason: string;
  contact_phone: string | null;
  owner_notified_at: string | null;
  owner_message_sid: string | null;
  created_at: string;
};

export type EscalationInsert = {
  id?: string;
  tenant_id: string;
  call_id?: string | null;
  conversation_id?: string | null;
  source: EscalationSource;
  reason: string;
  contact_phone?: string | null;
  owner_notified_at?: string | null;
  owner_message_sid?: string | null;
  created_at?: string;
};

export type EscalationUpdate = {
  owner_notified_at?: string | null;
  owner_message_sid?: string | null;
};

export type LibraryDocumentRow = {
  id: string;
  title: string;
  source_type: string;
  source_ref: string;
  content_hash: string;
  raw_text: string;
  metadata: Json;
  ingested_at: string;
};

export type LibraryDocumentInsert = {
  id?: string;
  title: string;
  source_type: string;
  source_ref: string;
  content_hash: string;
  raw_text: string;
  metadata?: Json;
  ingested_at?: string;
};

export type LibraryDocumentUpdate = {
  title?: string;
  source_type?: string;
  source_ref?: string;
  content_hash?: string;
  raw_text?: string;
  metadata?: Json;
  ingested_at?: string;
};

export type LibraryChunkRow = {
  id: string;
  document_id: string;
  position: number;
  section_path: string | null;
  content: string;
  content_tsvector: unknown;
  embedding: string | null;
  metadata: Json;
  created_at: string;
};

export type LibraryChunkInsert = {
  id?: string;
  document_id: string;
  position: number;
  section_path?: string | null;
  content: string;
  embedding?: string | null;
  metadata?: Json;
  created_at?: string;
};

export type LibraryChunkUpdate = {
  position?: number;
  section_path?: string | null;
  content?: string;
  embedding?: string | null;
  metadata?: Json;
};

export type LibraryTreeNodeRow = {
  id: string;
  document_id: string;
  parent_id: string | null;
  depth: number;
  position: number;
  title: string;
  content_full: string;
  content_summary: string;
  path_titles: string[];
  metadata: Json;
  created_at: string;
};

export type LibraryTreeNodeInsert = {
  id?: string;
  document_id: string;
  parent_id?: string | null;
  depth: number;
  position: number;
  title: string;
  content_full: string;
  content_summary: string;
  path_titles: string[];
  metadata?: Json;
  created_at?: string;
};

export type LibraryTreeNodeUpdate = {
  parent_id?: string | null;
  depth?: number;
  position?: number;
  title?: string;
  content_full?: string;
  content_summary?: string;
  path_titles?: string[];
  metadata?: Json;
};

export type LibraryPageIndexSummaryCacheRow = {
  content_hash: string;
  model: string;
  summary: string;
  cost_usd: number;
  created_at: string;
};

export type LibraryPageIndexSummaryCacheInsert = {
  content_hash: string;
  model: string;
  summary: string;
  cost_usd?: number;
  created_at?: string;
};

export type LibraryPageIndexNavCacheRow = {
  query_hash: string;
  tree_revision: string;
  result_node_ids: string[];
  trace: Json;
  cost_usd: number;
  created_at: string;
};

export type LibraryPageIndexNavCacheInsert = {
  query_hash: string;
  tree_revision: string;
  result_node_ids?: string[];
  trace?: Json;
  cost_usd?: number;
  created_at?: string;
};

export type LibraryEvalQueryRow = {
  id: string;
  query: string;
  ideal_answer: string | null;
  relevant_chunk_ids: string[] | null;
  relevant_node_ids: string[] | null;
  source: EvalQuerySource;
  notes: string | null;
  created_at: string;
};

export type LibraryEvalQueryInsert = {
  id?: string;
  query: string;
  ideal_answer?: string | null;
  relevant_chunk_ids?: string[] | null;
  relevant_node_ids?: string[] | null;
  source: EvalQuerySource;
  notes?: string | null;
  created_at?: string;
};

export type LibraryEvalRunRow = {
  id: string;
  pipeline: RagPipelineName;
  config: Json;
  dataset_size: number;
  started_at: string;
  completed_at: string | null;
  summary: Json | null;
};

export type LibraryEvalRunInsert = {
  id?: string;
  pipeline: RagPipelineName;
  config?: Json;
  dataset_size: number;
  started_at?: string;
  completed_at?: string | null;
  summary?: Json | null;
};

export type LibraryEvalRunUpdate = {
  config?: Json;
  dataset_size?: number;
  completed_at?: string | null;
  summary?: Json | null;
};

export type LibraryEvalResultRow = {
  id: string;
  run_id: string;
  query_id: string;
  retrieved: Json;
  latency_ms: number;
  cost_usd: number;
  recall_at_5: number | null;
  recall_at_8: number | null;
  mrr: number | null;
  ndcg_at_10: number | null;
  judge_score: number | null;
  judge_reasoning: string | null;
  created_at: string;
};

export type LibraryEvalResultInsert = {
  id?: string;
  run_id: string;
  query_id: string;
  retrieved: Json;
  latency_ms: number;
  cost_usd?: number;
  recall_at_5?: number | null;
  recall_at_8?: number | null;
  mrr?: number | null;
  ndcg_at_10?: number | null;
  judge_score?: number | null;
  judge_reasoning?: string | null;
  created_at?: string;
};

export type HybridSearchRow = {
  id: string;
  document_id: string;
  content: string;
  section_path: string | null;
  metadata: Json;
  score: number;
};

export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: TenantRow;
        Insert: TenantInsert;
        Update: TenantUpdate;
        Relationships: [];
      };
      tenant_phone_numbers: {
        Row: TenantPhoneNumberRow;
        Insert: TenantPhoneNumberInsert;
        Update: Partial<TenantPhoneNumberInsert>;
        Relationships: [];
      };
      tenant_voice_configs: {
        Row: TenantVoiceConfigRow;
        Insert: TenantVoiceConfigInsert;
        Update: TenantVoiceConfigUpdate;
        Relationships: [];
      };
      tenant_sms_configs: {
        Row: TenantSmsConfigRow;
        Insert: TenantSmsConfigInsert;
        Update: TenantSmsConfigUpdate;
        Relationships: [];
      };
      consumer_optouts: {
        Row: ConsumerOptoutRow;
        Insert: ConsumerOptoutInsert;
        Update: ConsumerOptoutUpdate;
        Relationships: [];
      };
      tenant_owner_configs: {
        Row: TenantOwnerConfigRow;
        Insert: TenantOwnerConfigInsert;
        Update: TenantOwnerConfigUpdate;
        Relationships: [];
      };
      tenant_review_configs: {
        Row: TenantReviewConfigRow;
        Insert: TenantReviewConfigInsert;
        Update: TenantReviewConfigUpdate;
        Relationships: [];
      };
      tenant_crm_configs: {
        Row: TenantCrmConfigRow;
        Insert: TenantCrmConfigInsert;
        Update: TenantCrmConfigUpdate;
        Relationships: [];
      };
      calls: {
        Row: CallRow;
        Insert: CallInsert;
        Update: CallUpdate;
        Relationships: [];
      };
      conversations: {
        Row: ConversationRow;
        Insert: ConversationInsert;
        Update: ConversationUpdate;
        Relationships: [];
      };
      messages: {
        Row: MessageRow;
        Insert: MessageInsert;
        Update: MessageUpdate;
        Relationships: [];
      };
      review_requests: {
        Row: ReviewRequestRow;
        Insert: ReviewRequestInsert;
        Update: ReviewRequestUpdate;
        Relationships: [];
      };
      escalations: {
        Row: EscalationRow;
        Insert: EscalationInsert;
        Update: EscalationUpdate;
        Relationships: [];
      };
      library_documents: {
        Row: LibraryDocumentRow;
        Insert: LibraryDocumentInsert;
        Update: LibraryDocumentUpdate;
        Relationships: [];
      };
      library_chunks: {
        Row: LibraryChunkRow;
        Insert: LibraryChunkInsert;
        Update: LibraryChunkUpdate;
        Relationships: [];
      };
      library_tree_nodes: {
        Row: LibraryTreeNodeRow;
        Insert: LibraryTreeNodeInsert;
        Update: LibraryTreeNodeUpdate;
        Relationships: [];
      };
      library_pageindex_summary_cache: {
        Row: LibraryPageIndexSummaryCacheRow;
        Insert: LibraryPageIndexSummaryCacheInsert;
        Update: Partial<LibraryPageIndexSummaryCacheInsert>;
        Relationships: [];
      };
      library_pageindex_nav_cache: {
        Row: LibraryPageIndexNavCacheRow;
        Insert: LibraryPageIndexNavCacheInsert;
        Update: Partial<LibraryPageIndexNavCacheInsert>;
        Relationships: [];
      };
      library_eval_queries: {
        Row: LibraryEvalQueryRow;
        Insert: LibraryEvalQueryInsert;
        Update: Partial<LibraryEvalQueryInsert>;
        Relationships: [];
      };
      library_eval_runs: {
        Row: LibraryEvalRunRow;
        Insert: LibraryEvalRunInsert;
        Update: LibraryEvalRunUpdate;
        Relationships: [];
      };
      library_eval_results: {
        Row: LibraryEvalResultRow;
        Insert: LibraryEvalResultInsert;
        Update: Partial<LibraryEvalResultInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      hybrid_bm25_search: {
        Args: {
          query_text: string;
          match_count?: number;
        };
        Returns: HybridSearchRow[];
      };
      hybrid_vector_search: {
        Args: {
          query_embedding: string;
          match_count?: number;
        };
        Returns: HybridSearchRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type TenantWithVoiceConfig = {
  tenant: TenantRow;
  voice_config: TenantVoiceConfigRow;
};

export type TenantWithConfigs = TenantWithVoiceConfig & {
  sms_config: TenantSmsConfigRow | null;
};

export type TenantDetails = TenantWithVoiceConfig & {
  phone_numbers: string[];
};
