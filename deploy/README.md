# Fly.io Deployment

v1 runs two Fly apps from the same Docker image:

- `voice-agents-worker`: LiveKit agent worker, command `node dist/agent.js start`.
- `voice-agents-api`: public HTTPS API, command `node dist/api.js`, hosting admin routes, Twilio webhooks, and `/api/inngest`.

## 1. Create Apps

```bash
flyctl auth login

flyctl launch --name voice-agents-worker --copy-config --config deploy/fly.toml --no-deploy
flyctl launch --name voice-agents-api --copy-config --config deploy/fly.api.toml --no-deploy
```

Adjust `primary_region` in both config files before launch if `iad` is not the right region.

## 2. Set Secrets

Set the same core secrets on both apps unless noted:

```bash
flyctl secrets set --app voice-agents-worker \
  RAG_WINNER=hybrid \
  LIVEKIT_URL=... \
  LIVEKIT_API_KEY=... \
  LIVEKIT_API_SECRET=... \
  OPENAI_API_KEY=... \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  INNGEST_EVENT_KEY=... \
  INNGEST_SIGNING_KEY=... \
  INNGEST_APP_ID=voice-agents \
  PUBLIC_BASE_URL=https://<api-host> \
  CRM_CREDENTIAL_KEY=...

flyctl secrets set --app voice-agents-api \
  RAG_WINNER=hybrid \
  OPENAI_API_KEY=... \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  ADMIN_API_KEY=... \
  TWILIO_ACCOUNT_SID=... \
  TWILIO_AUTH_TOKEN=... \
  INNGEST_EVENT_KEY=... \
  INNGEST_SIGNING_KEY=... \
  INNGEST_APP_ID=voice-agents \
  PUBLIC_BASE_URL=https://<api-host> \
  CRM_CREDENTIAL_KEY=... \
  COHERE_API_KEY=...
```

Also set optional runtime flags as needed: `HYBRID_RERANK_ENABLED`, `OWNER_NOTIFY_ENABLED`, `REVIEW_REQUESTS_ENABLED`, `CALL_SUMMARY_ENABLED`, `CRM_SYNC_ENABLED`, `FOLLOWUP_SMS_ENABLED`, model names, and `GHL_API_BASE_URL`.

Generate `CRM_CREDENTIAL_KEY` as a 32-byte base64 key:

```bash
openssl rand -base64 32
```

## 3. Deploy

```bash
flyctl deploy --app voice-agents-worker --config deploy/fly.toml
flyctl deploy --app voice-agents-api --config deploy/fly.api.toml
```

Validate configs before deploy when changing Fly settings:

```bash
flyctl config validate --config deploy/fly.toml
flyctl config validate --config deploy/fly.api.toml
```

## 4. Domain

Attach the production hostname to the API app:

```bash
flyctl certs add api.example.com --app voice-agents-api
```

Set `PUBLIC_BASE_URL=https://api.example.com` on both apps after DNS is active.

## 5. Inngest Cloud

1. Create an Inngest Cloud environment.
2. Copy `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` into both Fly apps.
3. Set the Inngest Cloud Sync URL to:

```text
https://<api-host>/api/inngest
```

4. Confirm the Cloud UI lists the SMS, follow-up, review, summary, CRM sync, and owner notification functions.

## 6. Twilio

For each tenant messaging number, set the Messaging webhook to:

```text
https://<api-host>/webhooks/twilio/sms
```

Voice routing stays on the LiveKit SIP path from earlier iterations.

## 7. Supabase

Confirm extensions are enabled:

- `pgcrypto`
- `vector`

Run migrations in order:

```text
20260524000000_init_tenants.sql
20260525000000_sms_and_conversations.sql
20260526000000_library_rag.sql
20260527000000_v1_ship.sql
```

Run `supabase/seed.sql` for at least one tenant, then configure tenant phone numbers, SMS config, owner config, review config, and CRM config through the admin API.
