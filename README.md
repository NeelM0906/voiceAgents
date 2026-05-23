# voiceAgents

Iteration 2 turns the inbound voice loop into a multi-tenant service:

Twilio phone number -> shared TwiML SIP dial -> LiveKit Cloud SIP inbound trunk -> LiveKit dispatch rule -> LiveKit room -> Node.js agent worker -> Supabase tenant lookup -> OpenAI Realtime conversation.

Supabase is the system of record for tenants, phone numbers, voice configs, and call rows. A separate Hono admin API provisions tenants and phone numbers. The worker still handles the same inbound voice behavior for any single tenant; it now loads instructions, first message, model, and voice from the database on each call.

Out of scope remains SMS, CRM connectors, RAG, tools, dashboards, outbound calling, transcript persistence, automated Twilio/LiveKit provisioning, and advanced API auth beyond `ADMIN_API_KEY`.

## Requirements

- Node.js 20 or newer
- pnpm 10.30.x
- Python 3 for the local `.venv` shell workflow
- LiveKit Cloud project and authenticated LiveKit CLI
- Twilio phone number
- OpenAI API key with Realtime access
- Supabase project

All local development and checks should run from the repo venv:

```bash
python3 -m venv .venv
. .venv/bin/activate
pnpm install
```

## Environment

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

| Variable | Required | Notes |
| --- | --- | --- |
| `LIVEKIT_URL` | worker | LiveKit Cloud websocket URL, for example `wss://project.livekit.cloud`. |
| `LIVEKIT_API_KEY` | worker | LiveKit API key. |
| `LIVEKIT_API_SECRET` | worker | LiveKit API secret. |
| `OPENAI_API_KEY` | worker | OpenAI API key. |
| `LIVEKIT_AGENT_NAME` | worker | Worker dispatch name. Defaults to `inbound-agent`; dispatch rules must match it. |
| `SUPABASE_URL` | both | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | both | Server-side service role key. Do not expose it to browsers. |
| `ADMIN_API_KEY` | api | Long random shared secret required by all `/admin/*` routes. |
| `API_PORT` | api | Defaults to `8787`. |
| `NO_TENANT_FALLBACK_MESSAGE` | worker | Message spoken before hangup when a called number is not configured. |
| `LOG_LEVEL` | both | `trace`, `debug`, `info`, `warn`, `error`, or `fatal`. |

## Supabase

Apply the raw SQL migration in `supabase/migrations/20260524000000_init_tenants.sql` to a clean Supabase project, then run `supabase/seed.sql`.

The migration creates:

- `tenants`
- `tenant_phone_numbers`
- `tenant_voice_configs`
- `calls`
- indexes on tenant phone numbers and call lookup fields
- `updated_at` triggers for tenants and voice configs

The seed inserts the Acme Roofing tenant, voice config, and placeholder number `+15550001111`. Replace that number during local setup.

The seed is idempotent and can be re-run safely.

## Run Locally

```bash
. .venv/bin/activate
pnpm download-files
pnpm dev
```

`pnpm dev` runs both processes:

- `pnpm dev:worker` starts the LiveKit agent worker.
- `pnpm dev:api` starts the Hono admin API on `API_PORT`.

Run them separately when debugging one process:

```bash
pnpm dev:worker
pnpm dev:api
```

## Admin API

All `/admin/*` routes require:

```text
x-api-key: <ADMIN_API_KEY>
```

`GET /healthz` does not require auth and returns:

```json
{ "ok": true, "supabase": "reachable" }
```

### Create Tenant

`POST /admin/tenants`

```json
{
  "slug": "acme-roofing",
  "name": "Acme Roofing",
  "voice_config": {
    "business_name": "Acme Roofing",
    "first_message": "Hi, thanks for calling Acme Roofing. How can I help today?",
    "system_prompt": "You are a phone-answering AI for a small business.",
    "voice": "marin",
    "model": "gpt-realtime"
  }
}
```

Responses:

- `201 { tenant, voice_config }`
- `400` for invalid JSON or zod validation errors
- `401` without the correct API key
- `409` if the slug already exists

### Get Tenant

`GET /admin/tenants/:slugOrId`

Response:

```json
{
  "tenant": {},
  "voice_config": {},
  "phone_numbers": []
}
```

Returns `404` if not found.

### Update Voice Config

`PATCH /admin/tenants/:slugOrId/voice-config`

Body may include any subset of:

```json
{
  "business_name": "Acme Roofing",
  "first_message": "Hi, thanks for calling Acme Roofing. How can I help today?",
  "system_prompt": "You are a phone-answering AI for a small business.",
  "voice": "marin",
  "model": "gpt-realtime"
}
```

Response: `200 { voice_config }`. The database trigger advances `updated_at`.

### Phone Numbers

`POST /admin/tenants/:slugOrId/phone-numbers`

```json
{ "phone_number": "+15551234567" }
```

Responses:

- `201 { phone_number, tenant_id }`
- `409` if the phone number is already attached to any tenant
- `404` if the tenant is not found

`DELETE /admin/tenants/:slugOrId/phone-numbers/:phoneNumber`

Use URL encoding for `+`, for example:

```bash
curl -X DELETE \
  -H "x-api-key: $ADMIN_API_KEY" \
  "http://localhost:8787/admin/tenants/acme-roofing/phone-numbers/%2B15551234567"
```

Returns `204` on delete and `404` if the number is already gone.

### Tenant Status

`PATCH /admin/tenants/:slugOrId/status`

```json
{ "status": "active" }
```

Status may be `active` or `paused`. Response: `200 { tenant }`.

## Build And Check

```bash
. .venv/bin/activate
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm download-files
```

## Docker

Build:

```bash
docker build -t voice-agents:iteration-2 .
```

Run the worker, which is the default command:

```bash
docker run --rm \
  -e LIVEKIT_URL \
  -e LIVEKIT_API_KEY \
  -e LIVEKIT_API_SECRET \
  -e OPENAI_API_KEY \
  -e LIVEKIT_AGENT_NAME=inbound-agent \
  -e SUPABASE_URL \
  -e SUPABASE_SERVICE_ROLE_KEY \
  -e NO_TENANT_FALLBACK_MESSAGE \
  voice-agents:iteration-2
```

Run the admin API from the same image by overriding the command:

```bash
docker run --rm -p 8787:8787 \
  -e SUPABASE_URL \
  -e SUPABASE_SERVICE_ROLE_KEY \
  -e ADMIN_API_KEY \
  -e API_PORT=8787 \
  voice-agents:iteration-2 node dist/api.js
```

## Manual Twilio And LiveKit Setup

These steps are performed by a human in LiveKit Cloud, LiveKit CLI, Twilio, and the admin API.

1. In LiveKit Cloud, create or select the project for this agent.
2. Copy the project websocket URL, API key, and API secret into `.env.local`.
3. In LiveKit Cloud project settings, find the SIP endpoint host. Use the host without the leading `sip:`.
4. In Twilio, create a shared TwiML Bin that dials LiveKit SIP with `{{To}}`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip username="<sip_trunk_username>" password="<sip_trunk_password>">
      sip:{{To}}@<your_livekit_sip_endpoint>;transport=tcp
    </Sip>
  </Dial>
</Response>
```

5. In Twilio, open each phone number voice configuration and set "A call comes in" to the shared TwiML Bin.
6. Create `inbound-trunk.json` locally for the LiveKit CLI:

```json
{
  "trunk": {
    "name": "Twilio inbound trunk",
    "numbers": ["<your_twilio_phone_number>"],
    "authUsername": "<sip_trunk_username>",
    "authPassword": "<sip_trunk_password>"
  }
}
```

7. Create the inbound trunk:

```bash
lk sip inbound create inbound-trunk.json
```

8. Create `dispatch-rule.json` with an individual room per call and an explicit agent dispatch. The `agentName` must match `LIVEKIT_AGENT_NAME`.

```json
{
  "dispatch_rule": {
    "name": "Inbound call dispatch",
    "rule": {
      "dispatchRuleIndividual": {
        "roomPrefix": "call-"
      }
    },
    "roomConfig": {
      "agents": [
        {
          "agentName": "inbound-agent"
        }
      ]
    }
  }
}
```

9. Create the dispatch rule, binding it to the inbound trunk ID returned in step 7:

```bash
lk sip dispatch create dispatch-rule.json --trunks "<trunk-id>"
```

Do not change the trunk, dispatch rule, or agent dispatch name per tenant.

## Adding A Tenant Number

Adding a new tenant number end to end:

1. Buy or select a Twilio number and point "A call comes in" to the shared TwiML Bin.
2. `POST /admin/tenants` if this is a new tenant.
3. `POST /admin/tenants/:slug/phone-numbers` with the Twilio number in E.164 format.
4. Make a test call.

No LiveKit trunk or dispatch rule changes are required per tenant. The existing trunk catches any number forwarded into LiveKit, and the worker resolves the tenant from the called number at session start.

## Manual Call Flow Checks

Seeded Acme Roofing number:

1. Replace `+15550001111` in the seed or via the admin API with a real Twilio number.
2. Start Supabase-backed worker and API with `pnpm dev`.
3. Call the configured number.
4. Confirm the agent says the seeded first message.
5. Confirm a `calls` row is inserted with `status = 'in_progress'` and later advances to `completed`.

Unregistered number:

1. Call a Twilio number that points to the shared TwiML Bin but is not in `tenant_phone_numbers`.
2. Confirm the caller hears `NO_TENANT_FALLBACK_MESSAGE`.
3. Confirm the room disconnects cleanly.
4. Confirm a `calls` row is inserted with `status = 'rejected_no_tenant'` and an `ended_at` timestamp.

LiveKit references:

- SIP participant attributes: https://docs.livekit.io/sip/sip-participant/
- Agents JS lifecycle: https://github.com/livekit/agents-js
- Hono Node adapter: https://hono.dev/docs/getting-started/nodejs
- Supabase JS: https://supabase.com/docs/reference/javascript/installing
