-- Iteration 5 ships v1 additively. Existing iteration 2-4 tables are preserved.

comment on table library_tree_nodes is
  'Iteration 5 selected hybrid RAG for v1; page_index writes are deprecated and this table is retained non-destructively for historical/eval data.';

create table if not exists consumer_optouts (
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_phone text not null,
  reason text not null default 'stop_keyword'
    check (reason in ('stop_keyword', 'manual', 'complaint')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, contact_phone)
);

create table if not exists tenant_owner_configs (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  owner_name text,
  owner_phone text,
  notify_on_emergency boolean not null default true,
  notify_on_missed_call boolean not null default false,
  updated_at timestamptz not null default now()
);

drop trigger if exists tenant_owner_configs_set_updated_at on tenant_owner_configs;
create trigger tenant_owner_configs_set_updated_at before update
  on tenant_owner_configs for each row execute function set_updated_at();

create table if not exists tenant_review_configs (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  enabled boolean not null default false,
  review_link text not null,
  template text not null,
  delay_seconds integer not null default 1800
    check (delay_seconds >= 0 and delay_seconds <= 86400),
  send_after_call_min_duration_seconds integer not null default 60,
  updated_at timestamptz not null default now()
);

drop trigger if exists tenant_review_configs_set_updated_at on tenant_review_configs;
create trigger tenant_review_configs_set_updated_at before update
  on tenant_review_configs for each row execute function set_updated_at();

create table if not exists tenant_crm_configs (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  provider text not null check (provider in ('ghl')),
  location_id text not null,
  api_key_encrypted text not null,
  pipeline_id text,
  default_stage_id text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

drop trigger if exists tenant_crm_configs_set_updated_at on tenant_crm_configs;
create trigger tenant_crm_configs_set_updated_at before update
  on tenant_crm_configs for each row execute function set_updated_at();

create table if not exists review_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  call_id uuid not null references calls(id) on delete cascade,
  contact_phone text not null,
  status text not null check (status in ('queued', 'sent', 'skipped', 'failed')),
  skipped_reason text,
  message_sid text,
  created_at timestamptz not null default now(),
  unique (call_id)
);
create index if not exists review_requests_tenant_created_idx
  on review_requests (tenant_id, created_at desc);

create table if not exists escalations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  call_id uuid references calls(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  source text not null check (source in ('voice', 'sms')),
  reason text not null,
  contact_phone text,
  owner_notified_at timestamptz,
  owner_message_sid text,
  created_at timestamptz not null default now()
);
create index if not exists escalations_tenant_created_idx
  on escalations (tenant_id, created_at desc);

alter table calls
  add column if not exists summary text,
  add column if not exists key_facts jsonb,
  add column if not exists outcome text;

alter table conversations
  add column if not exists crm_contact_id text,
  add column if not exists crm_last_synced_at timestamptz;
