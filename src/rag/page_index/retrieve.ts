import { config } from '../../config.js';
import { roundCost } from '../cost.js';
import type { RetrievalPipeline, RetrievalResult } from '../types.js';
import { navigatePageIndex } from './navigator.js';

export class PageIndexRetrievalPipeline implements RetrievalPipeline {
  name = 'page_index' as const;

  async retrieve(
    query: string,
    opts?: { k?: number; tenantId?: string },
  ): Promise<{ results: RetrievalResult[]; latencyMs: number; costUsd: number; trace: unknown }> {
    const started = Date.now();
    const k = clampTopK(opts?.k ?? config.RAG_TOP_K);
    const navigation = await navigatePageIndex(query);
    const results = navigation.nodes.slice(0, k).map((node): RetrievalResult => {
      const content = `${node.path_titles.join(' > ')}\n\n${node.content_full}`;

      return {
        chunkOrNodeId: node.id,
        documentId: node.document_id,
        content,
        score: 1,
        path: node.path_titles,
        metadata: {
          ...normalizeMetadata(node.metadata),
          title: node.title,
          hops_taken: navigation.trace.hops.length,
          cache_hit: navigation.trace.cacheHit,
        },
      };
    });

    return {
      results,
      latencyMs: Date.now() - started,
      costUsd: roundCost(navigation.costUsd),
      trace: {
        tenantId: opts?.tenantId,
        ...navigation.trace,
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
