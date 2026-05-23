insert into tenants (slug, name) values ('acme-roofing', 'Acme Roofing')
  on conflict (slug) do nothing;

insert into tenant_voice_configs (tenant_id, business_name, first_message, system_prompt)
select id,
       'Acme Roofing',
       'Hi, thanks for calling Acme Roofing. How can I help today?',
       $prompt$You are a phone-answering AI for a small business.

Your job in this prototype is to answer the call, hold a clear and helpful spoken conversation, and prove the voice loop works end to end.

Speak naturally and keep replies brief because the caller is on the phone.

Do not claim that you can book appointments, take payments, send SMS messages, access calendars, look up customer records, or store caller information.

If the caller asks for something this prototype cannot do, say that you cannot do that in this version and ask how else you can help.$prompt$
from tenants where slug = 'acme-roofing'
  on conflict (tenant_id) do nothing;

-- Replace +15550001111 with a real test number during local setup.
insert into tenant_phone_numbers (phone_number, tenant_id)
select '+15550001111', id from tenants where slug = 'acme-roofing'
  on conflict (phone_number) do nothing;
