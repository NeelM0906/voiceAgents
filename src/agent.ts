import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  waitForParticipant,
  voice,
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';
import { config, getWorkerConfig } from './config.js';
import { insertCall, updateCallEnded } from './db/calls.js';
import { getTenantByPhoneNumber } from './db/tenants.js';
import type { CallStatus, TenantWithVoiceConfig } from './db/types.js';
import { TECHNICAL_DIFFICULTIES_MESSAGE } from './instructions.js';
import { logger } from './logger.js';

type ProcessUserData = {
  vad?: silero.VAD;
};

type SipParticipant = {
  identity: string;
  kind?: number | string;
  info?: {
    kind?: number | string;
  };
  attributes: Record<string, string>;
};

type CallLogFields = {
  callId?: string;
  roomName: string;
  calledNumber?: string;
  callerNumber?: string | null;
  tenantId?: string;
  tenantSlug?: string;
  event: string;
};

const SIP_PARTICIPANT_KIND = 3;
const UNKNOWN_CALLED_NUMBER = 'unknown';
const workerConfig = getWorkerConfig();

function normalizePhoneNumber(value: string | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const withoutSipScheme = trimmed.replace(/^sip:/i, '');
  const userPart = withoutSipScheme.split('@')[0]?.trim();

  if (!userPart) {
    return null;
  }

  const normalized = userPart.startsWith('+') ? userPart : `+${userPart}`;
  return /^\+[1-9]\d{1,14}$/.test(normalized) ? normalized : null;
}

function getCalledNumber(participant: SipParticipant): string | null {
  return (
    normalizePhoneNumber(participant.attributes['sip.toUser']) ??
    normalizePhoneNumber(participant.attributes['sip.trunkPhoneNumber']) ??
    normalizePhoneNumber(participant.attributes['sip.calledNumber'])
  );
}

function getCallerNumber(participant: SipParticipant): string | null {
  return normalizePhoneNumber(participant.attributes['sip.phoneNumber']);
}

function getSipCallId(participant: SipParticipant): string | null {
  return (
    participant.attributes['sip.callID'] ??
    participant.attributes['sip.callIDFull'] ??
    participant.attributes['sip.twilio.callSid'] ??
    null
  );
}

function createCallFinalizer(callId: string, fields: Omit<CallLogFields, 'event'>) {
  let finalized = false;

  return async (status: CallStatus) => {
    if (finalized) {
      return;
    }

    finalized = true;

    try {
      await updateCallEnded(callId, status);
      logger.info({ ...fields, callId, event: 'session_ended', status }, 'session ended');
    } catch (error) {
      logger.error(
        { ...fields, callId, event: 'error', error },
        'failed to update call end status',
      );
    }
  };
}

function createSession(options: {
  vad: silero.VAD;
  model?: string;
  voiceName?: string;
}): voice.AgentSession {
  return new voice.AgentSession({
    vad: options.vad,
    llm: new openai.realtime.RealtimeModel({
      apiKey: workerConfig.OPENAI_API_KEY,
      model: options.model,
      voice: options.voiceName,
    }),
  });
}

async function speakAndDisconnect(options: {
  ctx: JobContext<ProcessUserData>;
  vad: silero.VAD;
  message: string;
  logFields: Omit<CallLogFields, 'event'>;
}) {
  const agent = new voice.Agent({
    instructions: 'Say exactly the provided message, then stop speaking.',
  });
  const session = createSession({ vad: options.vad });

  session.on(voice.AgentSessionEventTypes.Error, (event) => {
    logger.error({ ...options.logFields, event: 'error', error: event.error }, 'voice session error');
  });

  await session.start({
    agent,
    room: options.ctx.room,
  });

  await session
    .say(options.message, {
      allowInterruptions: false,
      addToChatCtx: false,
    })
    .waitForPlayout();
  await session.close();
  await options.ctx.room.disconnect();
}

async function insertFailedCall(options: {
  roomName: string;
  calledNumber: string;
  callerNumber: string | null;
  sipCallId: string | null;
  metadata: Record<string, string>;
}) {
  try {
    return await insertCall({
      livekit_room_name: options.roomName,
      called_number: options.calledNumber,
      caller_number: options.callerNumber,
      sip_call_id: options.sipCallId,
      status: 'failed',
      ended_at: new Date().toISOString(),
      metadata: options.metadata,
    });
  } catch (error) {
    logger.error(
      {
        roomName: options.roomName,
        calledNumber: options.calledNumber,
        callerNumber: options.callerNumber,
        event: 'error',
        error,
      },
      'failed to insert failed call row',
    );
    return null;
  }
}

async function startTenantSession(options: {
  ctx: JobContext<ProcessUserData>;
  vad: silero.VAD;
  tenantConfig: TenantWithVoiceConfig;
  roomName: string;
  calledNumber: string;
  callerNumber: string | null;
  sipCallId: string | null;
}) {
  const { tenant, voice_config: voiceConfig } = options.tenantConfig;
  const call = await insertCall({
    tenant_id: tenant.id,
    sip_call_id: options.sipCallId,
    livekit_room_name: options.roomName,
    caller_number: options.callerNumber,
    called_number: options.calledNumber,
    status: 'in_progress',
  });

  const logFields = {
    callId: call.id,
    roomName: options.roomName,
    calledNumber: options.calledNumber,
    callerNumber: options.callerNumber,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
  };
  const finalizeCall = createCallFinalizer(call.id, logFields);

  options.ctx.addShutdownCallback(async () => {
    await finalizeCall('completed');
  });

  logger.info({ ...logFields, event: 'tenant_resolved' }, 'tenant resolved');

  const agent = new voice.Agent({
    instructions: voiceConfig.system_prompt,
  });
  const session = createSession({
    vad: options.vad,
    model: voiceConfig.model,
    voiceName: voiceConfig.voice,
  });

  session.on(voice.AgentSessionEventTypes.Error, (event) => {
    logger.error({ ...logFields, event: 'error', error: event.error }, 'voice session error');
  });

  session.on(voice.AgentSessionEventTypes.Close, (event) => {
    logger.info({ ...logFields, event: 'session_ended', reason: event.reason }, 'voice session closed');
    void finalizeCall('completed');
  });

  try {
    await session.start({
      agent,
      room: options.ctx.room,
    });

    logger.info(
      {
        ...logFields,
        event: 'session_started',
        realtimeModel: voiceConfig.model,
        realtimeVoice: voiceConfig.voice,
      },
      'voice session started',
    );

    await session.say(voiceConfig.first_message).waitForPlayout();
  } catch (error) {
    logger.error({ ...logFields, event: 'error', error }, 'tenant voice session failed');
    await finalizeCall('failed');
    throw error;
  }
}

export default defineAgent<ProcessUserData>({
  prewarm: async (proc: JobProcess<ProcessUserData>) => {
    logger.info('prewarming silero vad');
    proc.userData.vad = await silero.VAD.load();
    logger.info('silero vad ready');
  },

  entry: async (ctx: JobContext<ProcessUserData>) => {
    const vad = ctx.proc.userData.vad;
    const roomName = ctx.job.room?.name ?? ctx.room.name ?? 'unknown';

    if (!vad) {
      throw new Error('Silero VAD was not initialized during prewarm');
    }

    logger.info(
      {
        agentName: config.LIVEKIT_AGENT_NAME,
        jobId: ctx.job.id,
        roomName,
      },
      'starting inbound voice session',
    );

    await ctx.connect();

    const participant = (await waitForParticipant({
      room: ctx.room,
      kind: SIP_PARTICIPANT_KIND,
    })) as SipParticipant;

    const calledNumber = getCalledNumber(participant);
    const callerNumber = getCallerNumber(participant);
    const sipCallId = getSipCallId(participant);
    const baseLogFields = {
      roomName,
      calledNumber: calledNumber ?? UNKNOWN_CALLED_NUMBER,
      callerNumber,
    };

    logger.info({ ...baseLogFields, event: 'call_received' }, 'call received');

    if (!calledNumber) {
      const failedCall = await insertFailedCall({
        roomName,
        calledNumber: UNKNOWN_CALLED_NUMBER,
        callerNumber,
        sipCallId,
        metadata: {
          reason: 'missing_called_number',
          participantIdentity: participant.identity,
        },
      });

      logger.error(
        {
          ...baseLogFields,
          callId: failedCall?.id,
          event: 'error',
          participantIdentity: participant.identity,
        },
        'SIP participant is missing called number',
      );

      await speakAndDisconnect({
        ctx,
        vad,
        message: TECHNICAL_DIFFICULTIES_MESSAGE,
        logFields: { ...baseLogFields, callId: failedCall?.id },
      });
      return;
    }

    let tenantConfig: TenantWithVoiceConfig | null;

    try {
      tenantConfig = await getTenantByPhoneNumber(calledNumber);
    } catch (error) {
      const failedCall = await insertFailedCall({
        roomName,
        calledNumber,
        callerNumber,
        sipCallId,
        metadata: {
          reason: 'tenant_lookup_failed',
        },
      });

      logger.error(
        { ...baseLogFields, callId: failedCall?.id, event: 'error', error },
        'tenant lookup failed',
      );

      await speakAndDisconnect({
        ctx,
        vad,
        message: TECHNICAL_DIFFICULTIES_MESSAGE,
        logFields: { ...baseLogFields, callId: failedCall?.id },
      });
      return;
    }

    if (!tenantConfig || tenantConfig.tenant.status !== 'active') {
      const call = await insertCall({
        tenant_id: tenantConfig?.tenant.id ?? null,
        sip_call_id: sipCallId,
        livekit_room_name: roomName,
        caller_number: callerNumber,
        called_number: calledNumber,
        status: 'rejected_no_tenant',
        ended_at: new Date().toISOString(),
        metadata: {
          reason: tenantConfig ? 'tenant_not_active' : 'tenant_not_found',
        },
      });
      const rejectionLogFields = {
        ...baseLogFields,
        callId: call.id,
        tenantId: tenantConfig?.tenant.id,
        tenantSlug: tenantConfig?.tenant.slug,
      };

      logger.info({ ...rejectionLogFields, event: 'tenant_not_found' }, 'tenant unavailable');

      await speakAndDisconnect({
        ctx,
        vad,
        message: config.NO_TENANT_FALLBACK_MESSAGE,
        logFields: rejectionLogFields,
      });
      return;
    }

    await startTenantSession({
      ctx,
      vad,
      tenantConfig,
      roomName,
      calledNumber,
      callerNumber,
      sipCallId,
    });
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: workerConfig.LIVEKIT_AGENT_NAME,
    apiKey: workerConfig.LIVEKIT_API_KEY,
    apiSecret: workerConfig.LIVEKIT_API_SECRET,
    logLevel: config.LOG_LEVEL,
    wsURL: workerConfig.LIVEKIT_URL,
  }),
);
