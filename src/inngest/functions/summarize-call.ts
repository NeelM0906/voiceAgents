import { config } from '../../config.js';
import { updateCallSummary } from '../../db/calls.js';
import { listMessagesForCall } from '../../db/messages.js';
import type { Json } from '../../db/types.js';
import { generateCallSummary } from '../../llm/summarize.js';
import { logger } from '../../logger.js';
import { inngest } from '../client.js';
import { callSummaryReadyEvent, voiceCallCompletedEvent } from '../events.js';

const functionLogger = logger.child({ component: 'inngest', function: 'summarize-call' });

export const summarizeCall = inngest.createFunction(
  {
    id: 'summarize-call',
    name: 'Summarize completed call',
    triggers: [{ event: voiceCallCompletedEvent }],
    idempotency: 'event.data.callId',
  },
  async ({ event, step }) => {
    const { callId, conversationId, tenantId } = event.data;
    const logFields = {
      callId,
      tenantId,
    };
    const emitReady = async () => {
      await step.run('emit-summary-ready', async () => {
        await inngest.send(
          callSummaryReadyEvent.create(
            {
              callId,
              tenantId,
              conversationId: conversationId ?? null,
            },
            {
              id: callId,
            },
          ),
        );
      });
    };

    if (!config.CALL_SUMMARY_ENABLED) {
      functionLogger.info({ ...logFields, reason: 'summary_disabled' }, 'skipping call summary');
      return {
        skipped: 'summary_disabled',
      };
    }

    const messages = await step.run('load-call-messages', async () => {
      return listMessagesForCall({
        tenantId,
        callId,
      });
    });

    const transcript = messages.map(formatTranscriptLine).join('\n').trim();

    if (!transcript) {
      await step.run('mark-dropped', async () => {
        await updateCallSummary({
          tenantId,
          callId,
          summary: null,
          keyFacts: {},
          outcome: 'dropped',
        });
      });
      await emitReady();

      return {
        callId,
        outcome: 'dropped',
      };
    }

    const summary = await step.run('generate-summary', async () => {
      return generateCallSummary({
        transcript,
      });
    });

    await step.run('persist-summary', async () => {
      await updateCallSummary({
        tenantId,
        callId,
        summary: summary.summary,
        keyFacts: summary.key_facts as Json,
        outcome: summary.outcome,
      });
    });

    await emitReady();

    functionLogger.info({ ...logFields, outcome: summary.outcome }, 'call summary written');

    return {
      callId,
      outcome: summary.outcome,
    };
  },
);

function formatTranscriptLine(message: {
  channel: string;
  role: string;
  content: string;
  created_at: string;
}): string {
  return `[${message.created_at}] [${message.channel}] [${message.role}] ${message.content}`;
}
