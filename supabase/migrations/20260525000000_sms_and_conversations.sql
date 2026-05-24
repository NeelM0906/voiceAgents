create table if not exists tenant_sms_configs (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  system_prompt text not null,
  model text not null default 'gpt-4o-mini',
  follow_up_sms_template text,
  follow_up_delay_seconds integer not null default 60
    check (follow_up_delay_seconds >= 0 and follow_up_delay_seconds <= 3600),
  updated_at timestamptz not null default now()
);

drop trigger if exists tenant_sms_configs_set_updated_at on tenant_sms_configs;
create trigger tenant_sms_configs_set_updated_at before update on tenant_sms_configs
  for each row execute function set_updated_at();

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_phone text not null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, contact_phone)
);
create index if not exists conversations_tenant_last_idx
  on conversations (tenant_id, last_message_at desc);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null check (channel in ('sms', 'voice')),
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  call_id uuid references calls(id) on delete set null,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists messages_external_id_unique
  on messages (external_id) where external_id is not null;
create index if not exists messages_conversation_created_idx
  on messages (conversation_id, created_at);
create index if not exists messages_tenant_created_idx
  on messages (tenant_id, created_at desc);

-- Seed an SMS config for the existing acme-roofing tenant so v3 has
-- something to test against without going through the API first.
insert into tenant_sms_configs (tenant_id, system_prompt, follow_up_sms_template)
select id,
       'You are the SMS assistant for Acme Roofing. Reply briefly, warmly, and concretely. Collect name, address, and what they need. If it sounds like active leak or storm damage, tell them you are escalating and someone will call back within 15 minutes. Keep replies under 320 characters.',
       'Thanks for calling Acme Roofing. If you need anything else, just text or call this number back.'
from tenants where slug = 'acme-roofing'
  on conflict (tenant_id) do nothing;
