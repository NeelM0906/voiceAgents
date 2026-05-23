export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type TenantStatus = 'active' | 'paused';
export type CallStatus = 'in_progress' | 'completed' | 'failed' | 'rejected_no_tenant';

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
      calls: {
        Row: CallRow;
        Insert: CallInsert;
        Update: CallUpdate;
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

export type TenantDetails = TenantWithVoiceConfig & {
  phone_numbers: string[];
};
