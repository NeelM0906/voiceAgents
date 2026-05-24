import { CohereClient } from 'cohere-ai';
import { config } from '../../config.js';
import { cohereRerankCostUsd, roundCost } from '../cost.js';

export type RerankDocument<T> = {
  item: T;
  text: string;
};

export type RerankResult<T> = {
  item: T;
  score: number;
};

export async function rerankDocuments<T>(
  query: string,
  documents: RerankDocument<T>[],
  topN: number,
): Promise<{ results: RerankResult<T>[]; costUsd: number; model: string | null }> {
  if (!config.HYBRID_RERANK_ENABLED || documents.length === 0) {
    return {
      results: documents.slice(0, topN).map((document, index) => ({
        item: document.item,
        score: 1 / (index + 1),
      })),
      costUsd: 0,
      model: null,
    };
  }

  if (!config.COHERE_API_KEY) {
    throw new Error('COHERE_API_KEY is required when HYBRID_RERANK_ENABLED=true');
  }

  const client = new CohereClient({
    token: config.COHERE_API_KEY,
  });
  const model = normalizeCohereRerankModel(config.COHERE_RERANK_MODEL);
  const response = await client.rerank({
    model,
    query,
    documents: documents.map((document) => document.text),
    topN,
    returnDocuments: false,
  });

  return {
    results: response.results.map((result) => ({
      item: documents[result.index]!.item,
      score: result.relevanceScore,
    })),
    costUsd: roundCost(cohereRerankCostUsd(documents.length)),
    model,
  };
}

function normalizeCohereRerankModel(model: string): string {
  if (model === 'rerank-3.5') {
    return 'rerank-v3.5';
  }

  return model;
}
