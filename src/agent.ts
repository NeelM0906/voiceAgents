import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  llm,
  waitForParticipant,
  voice,
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config, getWorkerConfig } from './config.js';
import {
  getOrCreateConversationByContact,
  bumpConversationLastMessageAt,
} from './db/conversations.js';
import { insertCall, updateCallEnded } from './db/calls.js';
import { insertMessage, recentMessagesForContext } from './db/messages.js';
import { getTenantByPhoneNumber } from './db/tenants.js';
import type { CallRow, CallStatus, MessageRow, TenantWithVoiceConfig } from './db/types.js';
import { inngest } from './inngest/client.js';
import { voiceCallCompletedEvent } from './inngest/events.js';
import { TECHNICAL_DIFFICULTIES_MESSAGE } from './instructions.js';
import { logger } from './logger.js';
import {
  searchMethodology,
  searchMethodologyArgsSchema,
} from './rag/tools/search_methodology.js';
import { normalizePhoneE164 } from './utils/phone.js';

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

function getCalledNumber(participant: SipParticipant): string | null {
  return (
    normalizePhoneE164(participant.attributes['sip.toUser']) ??
    normalizePhoneE164(participant.attributes['sip.trunkPhoneNumber']) ??
    normalizePhoneE164(participant.attributes['sip.calledNumber'])
  );
}

function getCallerNumber(participant: SipParticipant): string | null {
  return (
    normalizePhoneE164(participant.attributes['sip.fromUser']) ??
    normalizePhoneE164(participant.attributes['sip.phoneNumber'])
  );
}

function getSipCallId(participant: SipParticipant): string | null {
  return (
    participant.attributes['sip.callID'] ??
    participant.attributes['sip.callIDFull'] ??
    participant.attributes['sip.twilio.callSid'] ??
    null
  );
}

function createCallFinalizer(
  callId: string,
  fields: Omit<CallLogFields, 'event'>,
  onCompleted?: (call: CallRow) => Promise<void>,
) {
  let finalized = false;

  return async (status: CallStatus) => {
    if (finalized) {
      return;
    }

    finalized = true;

    let call: CallRow;

    try {
      call = await updateCallEnded(callId, status);
      logger.info({ ...fields, callId, event: 'session_ended', status }, 'session ended');
    } catch (error) {
      logger.error(
        { ...fields, callId, event: 'error', error },
        'failed to update call end status',
      );
      return;
    }

    if (status === 'completed' && onCompleted) {
      try {
        await onCompleted(call);
      } catch (error) {
        logger.error({ ...fields, callId, event: 'error', error }, 'call completion hook failed');
      }
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

  let conversationId: string | null = null;
  const contactPhone = normalizePhoneE164(options.callerNumber);

  if (contactPhone) {
    try {
      const conversation = await getOrCreateConversationByContact({
        tenantId: tenant.id,
        contactPhone,
      });
      conversationId = conversation.id;
    } catch (error) {
      logger.error({ ...logFields, event: 'error', error }, 'failed to create voice conversation');
    }
  }

  const finalizeCall = createCallFinalizer(call.id, logFields, async (completedCall) => {
    if (!contactPhone || tenant.status !== 'active') {
      return;
    }

    const durationMs = calculateDurationMs(completedCall);

    await inngest.send(
      voiceCallCompletedEvent.create(
        {
          callId: call.id,
          tenantId: tenant.id,
          contactPhone,
          calledNumber: options.calledNumber,
          durationMs,
        },
        {
          id: call.id,
        },
      ),
    );
  });

  options.ctx.addShutdownCallback(async () => {
    await finalizeCall('completed');
  });

  logger.info({ ...logFields, event: 'tenant_resolved' }, 'tenant resolved');

  const recentMessages = conversationId
    ? await loadRecentMessagesForVoiceContext({
        tenantId: tenant.id,
        conversationId,
        logFields,
      })
    : [];

  const agent = new voice.Agent({
    instructions: buildVoiceInstructions(voiceConfig.system_prompt, recentMessages),
    tools: buildVoiceTools({
      tenantId: tenant.id,
      logFields,
    }),
  });
  const session = createSession({
    vad: options.vad,
    model: voiceConfig.model,
    voiceName: voiceConfig.voice,
  });

  session.on(voice.AgentSessionEventTypes.Error, (event) => {
    logger.error({ ...logFields, event: 'error', error: event.error }, 'voice session error');
  });

  if (conversationId) {
    registerVoiceTranscriptPersistence({
      session,
      tenantId: tenant.id,
      conversationId,
      callId: call.id,
      logFields,
    });
  }

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

async function loadRecentMessagesForVoiceContext(input: {
  tenantId: string;
  conversationId: string;
  logFields: Omit<CallLogFields, 'event'>;
}): Promise<MessageRow[]> {
  try {
    const messages = await recentMessagesForContext({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      limit: config.SMS_HISTORY_WINDOW,
    });

    logger.info(
      {
        ...input.logFields,
        event: 'shared_context_loaded',
        historyCount: messages.length,
      },
      'loaded shared conversation context for voice',
    );

    return messages;
  } catch (error) {
    logger.error(
      { ...input.logFields, event: 'error', error },
      'failed to load shared conversation context',
    );
    return [];
  }
}

function buildVoiceInstructions(systemPrompt: string, recentMessages: MessageRow[]): string {
  if (recentMessages.length === 0) {
    return systemPrompt;
  }

  return `${formatRecentContext(recentMessages)}\n\n${systemPrompt}`;
}

function formatRecentContext(messages: MessageRow[]): string {
  return `Recent context (most recent last):\n${messages.map(formatContextLine).join('\n')}`;
}

function formatContextLine(message: MessageRow): string {
  const timestamp = new Date(message.created_at).toISOString().slice(0, 16).replace('T', ' ');
  return `[${timestamp}] [${message.channel}] [${message.role}]: ${message.content}`;
}

function registerVoiceTranscriptPersistence(input: {
  session: voice.AgentSession;
  tenantId: string;
  conversationId: string;
  callId: string;
  logFields: Omit<CallLogFields, 'event'>;
}) {
  input.session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
    if (!event.isFinal) {
      return;
    }

    persistVoiceMessage({
      ...input,
      role: 'user',
      content: event.transcript,
    });
  });

  input.session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (event) => {
    if (event.item.type !== 'message' || event.item.role !== 'assistant') {
      return;
    }

    const content = event.item.textContent?.trim();

    if (!content) {
      return;
    }

    persistVoiceMessage({
      ...input,
      role: 'assistant',
      content,
    });
  });
}

function buildVoiceTools(input: {
  tenantId: string;
  logFields: Omit<CallLogFields, 'event'>;
}): llm.ToolContext {
  return {
    search_methodology: llm.tool({
      description:
        "Search the company methodology library for guidance on handling this caller's situation. Use when the caller's question or situation calls for specific framing, scripts, or escalation rules.",
      parameters: z.object({
        query: z.string().trim().min(1).max(200),
        top_k: z.number().int().min(1).max(10).optional(),
      }),
      execute: async (args, opts) => {
        const parsedArgs = searchMethodologyArgsSchema.parse(args);
        let fillerTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          fillerTimer = null;
          void opts.ctx.session
            .say('Let me check on that.', {
              addToChatCtx: false,
              allowInterruptions: false,
            })
            .waitForPlayout()
            .catch((error) => {
              logger.warn(
                { ...input.logFields, event: 'tool_filler_failed', error },
                'failed to play retrieval filler',
              );
            });
        }, 400);

        try {
          return await searchMethodology({
            query: parsedArgs.query,
            topK: parsedArgs.top_k,
            tenantId: input.tenantId,
          });
        } finally {
          if (fillerTimer) {
            clearTimeout(fillerTimer);
          }
        }
      },
    }),
  };
}

function persistVoiceMessage(input: {
  tenantId: string;
  conversationId: string;
  callId: string;
  role: 'user' | 'assistant';
  content: string;
  logFields: Omit<CallLogFields, 'event'>;
}) {
  const content = input.content.trim();

  if (!content) {
    return;
  }

  void (async () => {
    try {
      const message = await insertMessage({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        channel: 'voice',
        role: input.role,
        content,
        callId: input.callId,
        metadata: {
          source: 'realtime',
        },
      });

      await bumpConversationLastMessageAt({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        lastMessageAt: message.created_at,
      });
    } catch (error) {
      logger.error(
        { ...input.logFields, callId: input.callId, event: 'error', error },
        'failed to persist voice message',
      );
    }
  })();
}

function calculateDurationMs(call: CallRow): number {
  const startedAt = Date.parse(call.started_at);
  const endedAt = call.ended_at ? Date.parse(call.ended_at) : Date.now();

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return 0;
  }

  return Math.max(0, endedAt - startedAt);
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
