import type OpenAI from 'openai';

type TokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const OPENAI_TOKEN_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'text-embedding-3-small': { inputPerMillion: 0.02, outputPerMillion: 0 },
};

const DEFAULT_CHAT_PRICING: ModelPricing = { inputPerMillion: 2.5, outputPerMillion: 10 };
const DEFAULT_EMBED_PRICING: ModelPricing = { inputPerMillion: 0.02, outputPerMillion: 0 };

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateTokensForTexts(texts: string[]): number {
  return texts.reduce((sum, text) => sum + estimateTokens(text), 0);
}

export function openAiEmbeddingCostUsd(model: string, tokens: number): number {
  const pricing = OPENAI_TOKEN_PRICING[model] ?? DEFAULT_EMBED_PRICING;
  return (tokens / 1_000_000) * pricing.inputPerMillion;
}

export function openAiChatCostUsd(model: string, usage?: TokenUsage | null): number {
  if (!usage) {
    return 0;
  }

  const pricing = OPENAI_TOKEN_PRICING[model] ?? DEFAULT_CHAT_PRICING;
  const input = usage.prompt_tokens ?? 0;
  const output = usage.completion_tokens ?? Math.max(0, (usage.total_tokens ?? 0) - input);

  return (input / 1_000_000) * pricing.inputPerMillion + (output / 1_000_000) * pricing.outputPerMillion;
}

export function chatCompletionCostUsd(
  model: string,
  completion: OpenAI.Chat.Completions.ChatCompletion,
): number {
  return openAiChatCostUsd(model, completion.usage);
}

export function cohereRerankCostUsd(documentCount: number): number {
  return Math.max(0, documentCount) * 0.000001;
}

export function roundCost(cost: number): number {
  return Math.round(cost * 1_000_000) / 1_000_000;
}
