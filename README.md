# voiceAgents

Iteration 3 turns the inbound voice loop into a multi-channel tenant service:

Twilio phone number -> shared TwiML SIP dial -> LiveKit Cloud SIP inbound trunk -> LiveKit dispatch rule -> LiveKit room -> Node.js agent worker -> Supabase tenant lookup -> OpenAI Realtime conversation.

SMS now follows a durable path:

Twilio Messaging webhook -> Hono -> Inngest event -> tenant + shared conversation lookup -> OpenAI chat completion -> Twilio REST reply.

Supabase is the system of record for tenants, phone numbers, voice configs, SMS configs, call rows, conversations, and messages. Voice and SMS share a `(tenant_id, contact_phone)` conversation key, so a caller who later texts continues the same thread.

Out of scope remains CRM connectors, RAG, tools, dashboards, outbound calling, MMS, automated Twilio/LiveKit provisioning, and advanced API auth beyond `ADMIN_API_KEY`.

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
| `OPENAI_API_KEY` | worker, api | OpenAI API key. Realtime uses it in the worker; SMS chat completions use it in Inngest functions served by the API. |
| `OPENAI_SMS_MODEL` | api | Defaults to `gpt-4o-mini`; used when an SMS config does not specify a model. |
| `LIVEKIT_AGENT_NAME` | worker | Worker dispatch name. Defaults to `inbound-agent`; dispatch rules must match it. |
| `SUPABASE_URL` | both | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | both | Server-side service role key. Do not expose it to browsers. |
| `ADMIN_API_KEY` | api | Long random shared secret required by all `/admin/*` routes. |
| `API_PORT` | api | Defaults to `8787`. |
| `TWILIO_ACCOUNT_SID` | api | Required for SMS webhook account checks and Twilio REST sends. |
| `TWILIO_AUTH_TOKEN` | api | Required for Twilio signature validation and REST sends. |
| `INNGEST_EVENT_KEY` | api, worker | Leave blank in local dev; the Inngest CLI handles it. Set in production. |
| `INNGEST_SIGNING_KEY` | api | Leave blank in local dev; set in production for Inngest request signing. |
| `INNGEST_APP_ID` | both | Defaults to `voice-agents`. |
| `PUBLIC_BASE_URL` | api | Public API origin. Twilio signatures are validated against `${PUBLIC_BASE_URL}/webhooks/twilio/sms`. |
| `SMS_HISTORY_WINDOW` | both | Number of recent shared messages included as context. Defaults to `20`. |
| `FOLLOWUP_SMS_ENABLED` | api | Set `false` to disable post-call follow-up SMS globally. |
| `NO_TENANT_FALLBACK_MESSAGE` | worker | Message spoken before hangup when a called number is not configured. |
| `LOG_LEVEL` | both | `trace`, `debug`, `info`, `warn`, `error`, or `fatal`. |

## Supabase

Apply the raw SQL migrations in order:

1. `supabase/migrations/20260524000000_init_tenants.sql`
2. `supabase/migrations/20260525000000_sms_and_conversations.sql`

Then run `supabase/seed.sql`.

The migrations create:

- `tenants`
- `tenant_phone_numbers`
- `tenant_voice_configs`
- `calls`
- `tenant_sms_configs`
- `conversations`
- `messages`
- indexes on tenant phone numbers and call lookup fields
- indexes for conversation and message lookup
- `updated_at` triggers for tenants, voice configs, and SMS configs

The seed inserts the Acme Roofing tenant, voice config, and placeholder number `+15550001111`. Replace that number during local setup.

The seed is idempotent and can be re-run safely.

The SMS migration also seeds an Acme Roofing SMS config with a short assistant prompt and a post-call follow-up template when the Acme tenant already exists.

## Shared Conversation State

Voice and SMS messages are stored in the same `messages` table under a `conversations` row keyed by `(tenant_id, contact_phone)`. The voice worker writes finalized user and assistant turns with `channel='voice'` and the current `call_id`. SMS functions write inbound and outbound texts with `channel='sms'` and Twilio SIDs in `external_id`.

Both channels load the recent `SMS_HISTORY_WINDOW` messages from that shared conversation. A call after a text sees the text history in the Realtime instructions; a text after a call sees the voice turns in the SMS chat completion context.

## Run Locally

```bash
. .venv/bin/activate
pnpm download-files
pnpm dev
```

`pnpm dev` runs three processes:

- `pnpm dev:worker` starts the LiveKit agent worker.
- `pnpm dev:api` starts the Hono admin API on `API_PORT`.
- `pnpm dev:inngest` starts `inngest-cli dev` against `http://localhost:${API_PORT:-8787}/api/inngest`.

The local Inngest UI is available at http://localhost:8288 and should list:

- `handle-inbound-sms`
- `send-followup-sms`

Run them separately when debugging one process:

```bash
pnpm dev:worker
pnpm dev:api
pnpm dev:inngest
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

### SMS Config

`GET /admin/tenants/:slugOrId/sms-config`

Returns `200 { sms_config }` or `404` when the tenant or SMS config is missing.

`POST /admin/tenants/:slugOrId/sms-config`

```json
{
  "system_prompt": "You are the SMS assistant for Acme Roofing. Keep replies brief.",
  "model": "gpt-4o-mini",
  "follow_up_sms_template": "Thanks for calling Acme Roofing. Text us here if you need anything else.",
  "follow_up_delay_seconds": 60
}
```

Responses:

- `201 { sms_config }`
- `409` if the SMS config already exists

`PATCH /admin/tenants/:slugOrId/sms-config`

Body may include any subset of the same fields. Response: `200 { sms_config }`.

### Conversations

`GET /admin/tenants/:slugOrId/conversations?contact_phone=&limit=&before_cursor=`

Response:

```json
{
  "conversations": [
    {
      "id": "conversation-id",
      "contact_phone": "+15551234567",
      "last_message_at": "2026-05-24T12:00:00.000Z",
      "message_count": 4
    }
  ]
}
```

`GET /admin/tenants/:slugOrId/conversations/:conversationId?limit=50&before_cursor=`

Response includes the conversation and chronological interleaved voice/SMS messages:

```json
{
  "conversation": {
    "id": "conversation-id",
    "contact_phone": "+15551234567",
    "last_message_at": "2026-05-24T12:00:00.000Z",
    "created_at": "2026-05-24T11:59:00.000Z"
  },
  "messages": [
    {
      "id": "message-id",
      "channel": "sms",
      "role": "assistant",
      "content": "Thanks for texting Acme Roofing.",
      "call_id": null,
      "created_at": "2026-05-24T12:00:00.000Z",
      "metadata": {}
    }
  ],
  "next_cursor": null
}
```

### Send Test SMS

`POST /admin/tenants/:slugOrId/send-test-sms`

```json
{
  "to": "+15551234567",
  "body": "Test from Acme Roofing."
}
```

The API sends via Twilio from the tenant's first registered phone number, creates or reuses the shared conversation, and persists the outbound message as `channel='sms'`, `role='assistant'`.

Responses:

- `201 { messageSid, persisted_message_id }`
- `400` when `to` is not E.164 or the body is empty/too long

## SMS Webhook

`POST /webhooks/twilio/sms` is public because Twilio calls it directly. It does not use `x-api-key`; it validates `X-Twilio-Signature` against `${PUBLIC_BASE_URL}/webhooks/twilio/sms` and verifies `AccountSid`.

The webhook returns empty TwiML immediately:

```xml
<Response/>
```

Replies are sent asynchronously by the `handle-inbound-sms` Inngest function through the Twilio REST API. Inbound SMS events are idempotent by `MessageSid`; the database also enforces uniqueness on `messages.external_id`.

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
docker build -t voice-agents:iteration-3 .
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
  -e INNGEST_EVENT_KEY \
  -e INNGEST_APP_ID=voice-agents \
  -e SMS_HISTORY_WINDOW=20 \
  -e NO_TENANT_FALLBACK_MESSAGE \
  voice-agents:iteration-3
```

Run the admin API from the same image by overriding the command:

```bash
docker run --rm -p 8787:8787 \
  -e SUPABASE_URL \
  -e SUPABASE_SERVICE_ROLE_KEY \
  -e ADMIN_API_KEY \
  -e OPENAI_API_KEY \
  -e OPENAI_SMS_MODEL=gpt-4o-mini \
  -e TWILIO_ACCOUNT_SID \
  -e TWILIO_AUTH_TOKEN \
  -e INNGEST_EVENT_KEY \
  -e INNGEST_SIGNING_KEY \
  -e INNGEST_APP_ID=voice-agents \
  -e PUBLIC_BASE_URL \
  -e SMS_HISTORY_WINDOW=20 \
  -e FOLLOWUP_SMS_ENABLED=true \
  -e API_PORT=8787 \
  voice-agents:iteration-3 node dist/api.js
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
6. In Twilio, open each phone number messaging configuration and set "A message comes in" to `${PUBLIC_BASE_URL}/webhooks/twilio/sms` with method `POST`.
7. Create `inbound-trunk.json` locally for the LiveKit CLI:

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

8. Create the inbound trunk:

```bash
lk sip inbound create inbound-trunk.json
```

9. Create `dispatch-rule.json` with an individual room per call and an explicit agent dispatch. The `agentName` must match `LIVEKIT_AGENT_NAME`.

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

10. Create the dispatch rule, binding it to the inbound trunk ID returned in step 8:

```bash
lk sip dispatch create dispatch-rule.json --trunks "<trunk-id>"
```

Do not change the trunk, dispatch rule, or agent dispatch name per tenant.

## Inngest

Local development does not require an Inngest account. `pnpm dev` starts:

```bash
npx inngest-cli@latest dev -u http://localhost:${API_PORT:-8787}/api/inngest
```

The API serves the function registration and execution endpoint at `/api/inngest`.

For production, create an Inngest account, set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, deploy the same API route publicly, and point Inngest Cloud at the production `/api/inngest` URL. No code changes are required.

## Adding A Tenant Number

Adding a new tenant number end to end:

1. Buy or select a Twilio number and point "A call comes in" to the shared TwiML Bin.
2. Point "A message comes in" to `${PUBLIC_BASE_URL}/webhooks/twilio/sms` with method `POST`.
3. `POST /admin/tenants` if this is a new tenant.
4. `POST /admin/tenants/:slug/phone-numbers` with the Twilio number in E.164 format.
5. `POST /admin/tenants/:slug/sms-config` if this tenant needs custom SMS behavior or post-call follow-up text.
6. Make a test call and send a test text.

No LiveKit trunk or dispatch rule changes are required per tenant. The existing trunk catches any number forwarded into LiveKit, and the worker resolves the tenant from the called number at session start.

## Manual Call Flow Checks

Seeded Acme Roofing number:

1. Replace `+15550001111` in the seed or via the admin API with a real Twilio number.
2. Start Supabase-backed worker, API, and Inngest dev server with `pnpm dev`.
3. Call the configured number.
4. Confirm the agent says the seeded first message.
5. Confirm a `calls` row is inserted with `status = 'in_progress'` and later advances to `completed`.
6. Confirm voice user and assistant turns appear in `messages` with `channel = 'voice'` and the `call_id`.
7. Confirm `send-followup-sms` runs after the configured delay when `follow_up_sms_template` is set.

Seeded Acme Roofing SMS:

1. Ensure the seeded tenant phone number is a real Twilio number and its Messaging webhook points to `${PUBLIC_BASE_URL}/webhooks/twilio/sms`.
2. Text the configured number.
3. Confirm `/webhooks/twilio/sms` returns `<Response/>` and the Inngest dev UI shows an `sms/inbound.received` event.
4. Confirm `handle-inbound-sms` inserts one user message and one assistant message with `channel = 'sms'`.
5. Send the same `MessageSid` again only in a controlled webhook replay test; confirm no duplicate assistant message is created.

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
- Inngest serving functions: https://www.inngest.com/docs/learn/serving-inngest-functions
- Inngest SDK serve adapters: https://www.inngest.com/docs/sdk/serve
- Twilio Node SDK: https://www.twilio.com/docs/libraries/node
- Twilio webhook security: https://www.twilio.com/docs/usage/webhooks/webhooks-security
- Twilio SMS webhook payloads: https://www.twilio.com/docs/messaging/guides/webhook-request
- OpenAI chat completions: https://platform.openai.com/docs/api-reference/chat
