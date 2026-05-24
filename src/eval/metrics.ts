import type { RetrievalResult } from '../rag/types.js';

export type RetrievalMetrics = {
  recallAt5: number | null;
  recallAt8: number | null;
  mrr: number | null;
  ndcgAt10: number | null;
};

export function computeRetrievalMetrics(input: {
  results: RetrievalResult[];
  relevantIds: string[];
}): RetrievalMetrics {
  const relevant = new Set(input.relevantIds);

  if (relevant.size === 0) {
    return {
      recallAt5: null,
      recallAt8: null,
      mrr: null,
      ndcgAt10: null,
    };
  }

  const ids = input.results.map((result) => result.chunkOrNodeId);

  return {
    recallAt5: recallAt(ids, relevant, 5),
    recallAt8: recallAt(ids, relevant, 8),
    mrr: meanReciprocalRank(ids, relevant),
    ndcgAt10: ndcgAt(ids, relevant, 10),
  };
}

function recallAt(ids: string[], relevant: Set<string>, k: number): number {
  const hits = ids.slice(0, k).filter((id) => relevant.has(id)).length;
  return hits / relevant.size;
}

function meanReciprocalRank(ids: string[], relevant: Set<string>): number {
  const rank = ids.findIndex((id) => relevant.has(id));
  return rank === -1 ? 0 : 1 / (rank + 1);
}

function ndcgAt(ids: string[], relevant: Set<string>, k: number): number {
  const dcg = ids.slice(0, k).reduce((sum, id, index) => {
    const rel = relevant.has(id) ? 1 : 0;
    return sum + rel / Math.log2(index + 2);
  }, 0);
  const idealHits = Math.min(relevant.size, k);
  let idcg = 0;

  for (let index = 0; index < idealHits; index += 1) {
    idcg += 1 / Math.log2(index + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}
