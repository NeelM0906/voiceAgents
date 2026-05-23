# voiceAgents

Iteration 1 proves the inbound voice loop:

Twilio phone number -> Twilio TwiML SIP dial -> LiveKit Cloud SIP inbound trunk -> LiveKit dispatch rule -> LiveKit room -> Node.js agent worker -> OpenAI Realtime conversation.

There is no database, SMS, multi-tenancy, web UI, booking, calendar, payments, CRM lookup, analytics pipeline, or outbound calling in this iteration.

## File Tree

```text
.
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── package.json
├── pnpm-lock.yaml
├── src
│   ├── agent.ts
│   ├── config.ts
│   ├── instructions.ts
│   └── logger.ts
└── tsconfig.json
```

## Requirements

- Node.js 20 or newer
- pnpm 10.30.x
- Python 3 for the local `.venv` shell workflow
- LiveKit Cloud project
- LiveKit CLI authenticated to that project
- Twilio phone number
- OpenAI API key with Realtime access

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
| `LIVEKIT_URL` | yes | LiveKit Cloud websocket URL, for example `wss://project.livekit.cloud`. |
| `LIVEKIT_API_KEY` | yes | LiveKit API key. |
| `LIVEKIT_API_SECRET` | yes | LiveKit API secret. |
| `OPENAI_API_KEY` | yes | OpenAI API key. |
| `LIVEKIT_AGENT_NAME` | yes | Worker dispatch name. Defaults to `inbound-agent`; dispatch rules must match it. |
| `OPENAI_REALTIME_MODEL` | no | Defaults to `gpt-realtime`. |
| `OPENAI_REALTIME_VOICE` | no | Defaults to `marin`. |
| `LOG_LEVEL` | no | `trace`, `debug`, `info`, `warn`, `error`, or `fatal`. |

## Run Locally

```bash
. .venv/bin/activate
pnpm download-files
pnpm dev
```

The worker starts in LiveKit development mode and registers as `LIVEKIT_AGENT_NAME`.

## Build And Check

```bash
. .venv/bin/activate
pnpm check
pnpm build
pnpm download-files
```

## Docker

Build:

```bash
docker build -t voice-agents:iteration-1 .
```

Run:

```bash
docker run --rm \
  -e LIVEKIT_URL \
  -e LIVEKIT_API_KEY \
  -e LIVEKIT_API_SECRET \
  -e OPENAI_API_KEY \
  -e LIVEKIT_AGENT_NAME=inbound-agent \
  voice-agents:iteration-1
```

## Manual Twilio And LiveKit Setup

These steps are performed by a human in LiveKit Cloud, LiveKit CLI, and Twilio.

1. In LiveKit Cloud, create or select the project for this agent.
2. Copy the project websocket URL, API key, and API secret into `.env.local`.
3. In LiveKit Cloud project settings, find the SIP endpoint host. Use the host without the leading `sip:`.
4. In Twilio, buy or select the phone number that should be answered by the AI.
5. In Twilio, create a TwiML Bin that dials LiveKit SIP:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip username="<sip_trunk_username>" password="<sip_trunk_password>">
      sip:<your_twilio_phone_number>@<your_livekit_sip_endpoint>;transport=tcp
    </Sip>
  </Dial>
</Response>
```

6. In Twilio, open the phone number voice configuration and set "A call comes in" to the TwiML Bin.
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

11. Start the worker with `pnpm dev`, call the Twilio number, and confirm:

- Twilio routes the call to the TwiML Bin.
- LiveKit creates a room with the `call-` prefix.
- A SIP participant joins the room.
- The `inbound-agent` worker joins the room.
- The caller hears the OpenAI Realtime assistant greeting.

LiveKit references:

- Voice AI Node quickstart: https://docs.livekit.io/agents/start/voice-ai/
- Telephony overview: https://docs.livekit.io/telephony/
- Twilio inbound calls: https://docs.livekit.io/telephony/accepting-calls/inbound-twilio/
- Inbound trunks: https://docs.livekit.io/telephony/accepting-calls/inbound-trunk/
- Dispatch rules: https://docs.livekit.io/telephony/accepting-calls/dispatch-rule/
- Agent dispatch: https://docs.livekit.io/agents/server/agent-dispatch/

## Acceptance Checks

1. `pnpm install --frozen-lockfile` succeeds.
2. `pnpm check` succeeds under TypeScript strict mode.
3. `pnpm build` emits `dist/`.
4. `pnpm download-files` succeeds.
5. `docker build -t voice-agents:iteration-1 .` succeeds.
6. Runtime env is validated before worker startup.
7. README documents the manual Twilio and LiveKit Cloud setup.
8. Code remains limited to the conversation spine and excludes all out-of-scope features.
