import OpenAI from 'openai';
import { config } from '../../config.js';
import { chatCompletionCostUsd, roundCost } from '../cost.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

export type HydeResult = {
  text: string;
  costUsd: number;
};

export async function expandWithHyde(query: string): Promise<HydeResult> {
  if (!config.HYBRID_HYDE_ENABLED) {
    return {
      text: query,
      costUsd: 0,
    };
  }

  const completion = await openai.chat.completions.create({
    model: config.HYBRID_HYDE_MODEL,
    temperature: 0,
    max_tokens: 180,
    messages: [
      {
        role: 'system',
        content:
          'Write a concise hypothetical answer that would likely appear in a company methodology document. Use 2-3 sentences. Do not mention that it is hypothetical.',
      },
      {
        role: 'user',
        content: query,
      },
    ],
  });

  const text = completion.choices[0]?.message.content?.trim();

  return {
    text: text || query,
    costUsd: roundCost(chatCompletionCostUsd(config.HYBRID_HYDE_MODEL, completion)),
  };
}
