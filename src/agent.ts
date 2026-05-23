import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  voice,
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { INITIAL_GREETING_INSTRUCTIONS, PHONE_AGENT_INSTRUCTIONS } from './instructions.js';
import { logger } from './logger.js';

type ProcessUserData = {
  vad?: silero.VAD;
};

export default defineAgent<ProcessUserData>({
  prewarm: async (proc: JobProcess<ProcessUserData>) => {
    logger.info('prewarming silero vad');
    proc.userData.vad = await silero.VAD.load();
    logger.info('silero vad ready');
  },

  entry: async (ctx: JobContext<ProcessUserData>) => {
    const vad = ctx.proc.userData.vad;

    if (!vad) {
      throw new Error('Silero VAD was not initialized during prewarm');
    }

    logger.info(
      {
        agentName: config.LIVEKIT_AGENT_NAME,
        jobId: ctx.job.id,
        roomName: ctx.job.room?.name,
        realtimeModel: config.OPENAI_REALTIME_MODEL,
        realtimeVoice: config.OPENAI_REALTIME_VOICE,
      },
      'starting inbound voice session',
    );

    const agent = new voice.Agent({
      instructions: PHONE_AGENT_INSTRUCTIONS,
    });

    const session = new voice.AgentSession({
      vad,
      llm: new openai.realtime.RealtimeModel({
        apiKey: config.OPENAI_API_KEY,
        model: config.OPENAI_REALTIME_MODEL,
        voice: config.OPENAI_REALTIME_VOICE,
      }),
    });

    session.on(voice.AgentSessionEventTypes.Error, (event) => {
      logger.error({ error: event.error }, 'voice session error');
    });

    session.on(voice.AgentSessionEventTypes.Close, (event) => {
      logger.info({ reason: event.reason }, 'voice session closed');
    });

    await session.start({
      agent,
      room: ctx.room,
    });

    await ctx.connect();

    await session.generateReply({
      instructions: INITIAL_GREETING_INSTRUCTIONS,
    });
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: config.LIVEKIT_AGENT_NAME,
    apiKey: config.LIVEKIT_API_KEY,
    apiSecret: config.LIVEKIT_API_SECRET,
    logLevel: config.LOG_LEVEL,
    wsURL: config.LIVEKIT_URL,
  }),
);
