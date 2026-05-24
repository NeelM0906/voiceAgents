import OpenAI from 'openai';
import { config } from '../../config.js';
import { estimateTokensForTexts, openAiEmbeddingCostUsd, roundCost } from '../cost.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

export type EmbeddingResult = {
  embeddings: number[][];
  costUsd: number;
  tokens: number;
};

export async function embedTexts(texts: string[], model = config.OPENAI_EMBED_MODEL): Promise<EmbeddingResult> {
  if (texts.length === 0) {
    return {
      embeddings: [],
      costUsd: 0,
      tokens: 0,
    };
  }

  const response = await openai.embeddings.create({
    model,
    input: texts,
  });

  const tokens = response.usage?.total_tokens ?? estimateTokensForTexts(texts);

  return {
    embeddings: response.data.map((item) => item.embedding),
    costUsd: roundCost(openAiEmbeddingCostUsd(model, tokens)),
    tokens,
  };
}

export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
