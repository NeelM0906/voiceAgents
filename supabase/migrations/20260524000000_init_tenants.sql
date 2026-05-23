create extension if not exists "pgcrypto";

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_phone_numbers (
  phone_number text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null default 'twilio',
  created_at timestamptz not null default now()
);
create index if not exists tenant_phone_numbers_tenant_id_idx
  on tenant_phone_numbers (tenant_id);

create table if not exists tenant_voice_configs (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  business_name text not null,
  first_message text not null,
  system_prompt text not null,
  voice text not null default 'marin',
  model text not null default 'gpt-realtime',
  updated_at timestamptz not null default now()
);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete set null,
  sip_call_id text,
  livekit_room_name text not null,
  caller_number text,
  called_number text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'failed', 'rejected_no_tenant')),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists calls_tenant_id_started_at_idx
  on calls (tenant_id, started_at desc);
create index if not exists calls_called_number_idx on calls (called_number);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tenants_set_updated_at on tenants;
create trigger tenants_set_updated_at before update on tenants
  for each row execute function set_updated_at();

drop trigger if exists tenant_voice_configs_set_updated_at on tenant_voice_configs;
create trigger tenant_voice_configs_set_updated_at before update on tenant_voice_configs
  for each row execute function set_updated_at();
