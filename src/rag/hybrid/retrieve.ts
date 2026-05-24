import { config } from '../../config.js';
import { supabase } from '../../db/client.js';
import type { HybridSearchRow } from '../../db/types.js';
import { roundCost } from '../cost.js';
import type { RetrievalPipeline, RetrievalResult } from '../types.js';
import { embedTexts, toVectorLiteral } from './embed.js';
import { expandWithHyde } from './hyde.js';
import { reciprocalRankFusion } from './rrf.js';
import { rerankDocuments } from './rerank.js';

type Candidate = HybridSearchRow & {
  fusedScore: number;
  ranks: Record<string, number>;
};

export class HybridRetrievalPipeline implements RetrievalPipeline {
  name = 'hybrid' as const;

  async retrieve(
    query: string,
    opts?: { k?: number; tenantId?: string },
  ): Promise<{ results: RetrievalResult[]; latencyMs: number; costUsd: number; trace: unknown }> {
    const started = Date.now();
    const k = clampTopK(opts?.k ?? config.RAG_TOP_K);
    let costUsd = 0;

    const hyde = await expandWithHyde(query);
    costUsd += hyde.costUsd;

    const queryEmbedding = await embedTexts([hyde.text]);
    costUsd += queryEmbedding.costUsd;

    const [bm25Response, vectorResponse] = await Promise.all([
      supabase.rpc('hybrid_bm25_search', {
        query_text: query,
        match_count: 50,
      }),
      supabase.rpc('hybrid_vector_search', {
        query_embedding: toVectorLiteral(queryEmbedding.embeddings[0]!),
        match_count: 50,
      }),
    ]);

    if (bm25Response.error) {
      throw bm25Response.error;
    }

    if (vectorResponse.error) {
      throw vectorResponse.error;
    }

    const bm25 = bm25Response.data ?? [];
    const vector = vectorResponse.data ?? [];
    const candidateById = new Map<string, HybridSearchRow>();

    for (const candidate of [...bm25, ...vector]) {
      candidateById.set(candidate.id, candidate);
    }

    const fused = reciprocalRankFusion(
      {
        bm25: bm25.map((item) => ({ id: item.id, score: item.score })),
        vector: vector.map((item) => ({ id: item.id, score: item.score })),
      },
      { k: 60, limit: 50 },
    );

    const candidates = fused.flatMap((rank): Candidate[] => {
      const row = candidateById.get(rank.id);

      if (!row) {
        return [];
      }

      return [
        {
          ...row,
          fusedScore: rank.score,
          ranks: rank.ranks,
        },
      ];
    });

    const reranked = await rerankDocuments(
      query,
      candidates.map((candidate) => ({
        item: candidate,
        text: candidate.content,
      })),
      k,
    );
    costUsd += reranked.costUsd;

    const results = reranked.results.map((result): RetrievalResult => {
      const metadata = normalizeMetadata(result.item.metadata);

      return {
        chunkOrNodeId: result.item.id,
        documentId: result.item.document_id,
        content: result.item.content,
        score: result.score,
        path: pathFromMetadata(metadata, result.item.section_path),
        metadata: {
          ...metadata,
          bm25_rank: result.item.ranks.bm25,
          vector_rank: result.item.ranks.vector,
          fused_score: result.item.fusedScore,
          rerank_model: reranked.model,
        },
      };
    });

    return {
      results,
      latencyMs: Date.now() - started,
      costUsd: roundCost(costUsd),
      trace: {
        tenantId: opts?.tenantId,
        hydeEnabled: config.HYBRID_HYDE_ENABLED,
        hydeText: config.HYBRID_HYDE_ENABLED ? hyde.text : null,
        bm25Count: bm25.length,
        vectorCount: vector.length,
        fusedCount: candidates.length,
        rerankEnabled: config.HYBRID_RERANK_ENABLED,
      },
    };
  }
}

function clampTopK(k: number): number {
  return Math.max(1, Math.min(10, Math.trunc(k)));
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  return metadata as Record<string, unknown>;
}

function pathFromMetadata(metadata: Record<string, unknown>, sectionPath: string | null): string[] | undefined {
  const path = metadata.section_path;

  if (Array.isArray(path) && path.every((item) => typeof item === 'string')) {
    return path;
  }

  if (!sectionPath) {
    return undefined;
  }

  return sectionPath.split(' > ').filter(Boolean);
}
