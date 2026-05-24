import OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../config.js';
import { chatCompletionCostUsd, roundCost } from '../rag/cost.js';
import type { RetrievalResult } from '../rag/types.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

const judgeSchema = z.object({
  score: z.number().min(1).max(5),
  reasoning: z.string(),
});

export async function buildGroundedAnswer(input: {
  query: string;
  results: RetrievalResult[];
}): Promise<{ answer: string; costUsd: number }> {
  const context = input.results
    .map((result, index) => {
      const path = result.path?.join(' > ') ?? result.metadata.title ?? result.documentId;
      return `Context ${index + 1} (${path}):\n${result.content}`;
    })
    .join('\n\n---\n\n');
  const completion = await openai.chat.completions.create({
    model: config.EVAL_JUDGE_MODEL,
    temperature: 0,
    seed: 42,
    max_tokens: 360,
    messages: [
      {
        role: 'system',
        content: 'Answer using only the provided context. If insufficient, say so.',
      },
      {
        role: 'user',
        content: `Context:\n${context}\n\nQuestion: ${input.query}`,
      },
    ],
  });

  return {
    answer: completion.choices[0]?.message.content?.trim() || 'Insufficient context.',
    costUsd: roundCost(chatCompletionCostUsd(config.EVAL_JUDGE_MODEL, completion)),
  };
}

export async function judgeAnswer(input: {
  query: string;
  idealAnswer: string | null;
  retrievedContext: string;
  generatedAnswer: string;
}): Promise<{ score: number; reasoning: string; costUsd: number }> {
  const completion = await openai.chat.completions.create({
    model: config.EVAL_JUDGE_MODEL,
    temperature: 0,
    seed: 42,
    response_format: { type: 'json_object' },
    max_tokens: 260,
    messages: [
      {
        role: 'system',
        content:
          'Rate the generated answer 1-5 for faithfulness to context, completeness versus the ideal answer, and conciseness. Output JSON: { "score": number, "reasoning": string }.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          query: input.query,
          ideal_answer: input.idealAnswer,
          retrieved_context: input.retrievedContext.slice(0, 12000),
          generated_answer: input.generatedAnswer,
        }),
      },
    ],
  });
  const raw = completion.choices[0]?.message.content ?? '{}';
  const parsed = safeParseJudge(raw);

  return {
    ...parsed,
    costUsd: roundCost(chatCompletionCostUsd(config.EVAL_JUDGE_MODEL, completion)),
  };
}

function safeParseJudge(raw: string): { score: number; reasoning: string } {
  try {
    const parsed = judgeSchema.safeParse(JSON.parse(raw));

    if (parsed.success) {
      return {
        score: parsed.data.score,
        reasoning: parsed.data.reasoning,
      };
    }
  } catch {
    // Use conservative fallback below.
  }

  return {
    score: 1,
    reasoning: 'Judge response did not parse as JSON.',
  };
}
