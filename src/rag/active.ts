import { config } from '../config.js';
import { HybridIngestionPipeline } from './hybrid/ingest.js';
import { HybridRetrievalPipeline } from './hybrid/retrieve.js';
import { PageIndexIngestionPipeline } from './page_index/ingest.js';
import { PageIndexRetrievalPipeline } from './page_index/retrieve.js';
import type { IngestionPipeline, RetrievalPipeline, RetrievalPipelineName } from './types.js';

export function getRetrievalPipeline(name?: RetrievalPipelineName): RetrievalPipeline {
  const pipeline = name ?? config.ACTIVE_RAG_PIPELINE;

  if (pipeline === 'page_index') {
    return new PageIndexRetrievalPipeline();
  }

  return new HybridRetrievalPipeline();
}

export function getActiveRetrievalPipeline(): RetrievalPipeline {
  return getRetrievalPipeline(config.ACTIVE_RAG_PIPELINE);
}

export function getIngestionPipelines(): IngestionPipeline[] {
  return [new HybridIngestionPipeline(), new PageIndexIngestionPipeline()];
}
