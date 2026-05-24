export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type TenantStatus = 'active' | 'paused';
export type CallStatus = 'in_progress' | 'completed' | 'failed' | 'rejected_no_tenant';
export type MessageChannel = 'sms' | 'voice';
export type MessageRole = 'user' | 'assistant' | 'system';

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
};

export type ConversationRow = {
  id: string;
  tenant_id: string;
  contact_phone: string;
  last_message_at: string;
  created_at: string;
};

export type ConversationInsert = {
  id?: string;
  tenant_id: string;
  contact_phone: string;
  last_message_at?: string;
  created_at?: string;
};

export type ConversationUpdate = {
  contact_phone?: string;
  last_message_at?: string;
  created_at?: string;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
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
