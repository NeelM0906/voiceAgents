import { z } from 'zod';
import { logger } from '../../logger.js';
import { getActiveRetrievalPipeline } from '../active.js';

const toolLogger = logger.child({ component: 'rag-tool', tool: 'search_methodology' });

export const searchMethodologyArgsSchema = z.object({
  query: z.string().trim().min(1).max(200),
  top_k: z.number().int().min(1).max(10).optional(),
});

export type SearchMethodologyInput = {
  query: string;
  topK?: number;
  tenantId?: string;
};

export type SearchMethodologyOutput = {
  results: Array<{
    title: string;
    content: string;
    path?: string[];
  }>;
};

export async function searchMethodology(input: SearchMethodologyInput): Promise<SearchMethodologyOutput> {
  const query = input.query.trim().slice(0, 200);
  const k = Math.max(1, Math.min(10, Math.trunc(input.topK ?? 5)));
  const pipeline = getActiveRetrievalPipeline();
  const response = await pipeline.retrieve(query, {
    k,
    tenantId: input.tenantId,
  });

  const loggedResults = response.results.map((result) => ({
    id: result.chunkOrNodeId,
    documentId: result.documentId,
    title: titleForResult(result.metadata, result.path),
    score: result.score,
    path: result.path,
  }));

  toolLogger.info(
    {
      tenantId: input.tenantId,
      pipeline: pipeline.name,
      query,
      k,
      latencyMs: response.latencyMs,
      costUsd: response.costUsd,
      resultCount: response.results.length,
      results: loggedResults,
    },
    'search_methodology tool call completed',
  );

  toolLogger.debug(
    {
      tenantId: input.tenantId,
      pipeline: pipeline.name,
      query,
      results: response.results.map((result) => ({
        id: result.chunkOrNodeId,
        content: result.content,
      })),
    },
    'search_methodology retrieved content',
  );

  return {
    results: response.results.map((result) => ({
      title: titleForResult(result.metadata, result.path),
      content: result.content,
      path: result.path,
    })),
  };
}

function titleForResult(metadata: Record<string, unknown>, path?: string[]): string {
  const title = metadata.title;

  if (typeof title === 'string' && title.trim()) {
    return title;
  }

  return path?.[path.length - 1] ?? 'Methodology';
}
