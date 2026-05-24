import OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../config.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

const summarySchema = z.object({
  summary: z.string().trim().min(1),
  key_facts: z.record(z.string(), z.unknown()).default({}),
  outcome: z.enum(['completed_normally', 'escalated', 'dropped']),
});

export type CallSummary = z.output<typeof summarySchema>;

export async function generateCallSummary(input: {
  transcript: string;
  model?: string;
}): Promise<CallSummary> {
  const completion = await openai.chat.completions.create({
    model: input.model ?? config.CALL_SUMMARY_MODEL,
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'Summarize this AI receptionist call in 2-3 sentences. Extract structured key facts (caller name, callback number, address, what they need, urgency, follow-up required). Output JSON: { summary: string, key_facts: object, outcome: "completed_normally" | "escalated" | "dropped" }.',
      },
      {
        role: 'user',
        content: input.transcript,
      },
    ],
  });

  const content = completion.choices[0]?.message.content;

  if (!content) {
    throw new Error('OpenAI call summary returned no content');
  }

  return summarySchema.parse(JSON.parse(content));
}
