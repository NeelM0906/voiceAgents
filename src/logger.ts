import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  base: {
    service: 'voice-agent',
  },
  level: config.LOG_LEVEL,
  redact: {
    paths: ['LIVEKIT_API_SECRET', 'OPENAI_API_KEY', '*.apiKey', '*.apiSecret'],
    remove: true,
  },
});
