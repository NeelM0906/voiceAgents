export type RetrievalPipelineName = 'hybrid' | 'page_index';

export type RetrievalResult = {
  chunkOrNodeId: string;
  documentId: string;
  content: string;
  score: number;
  path?: string[];
  metadata: Record<string, unknown>;
};

export interface RetrievalPipeline {
  name: RetrievalPipelineName;
  retrieve(
    query: string,
    opts?: { k?: number; tenantId?: string },
  ): Promise<{ results: RetrievalResult[]; latencyMs: number; costUsd: number; trace: unknown }>;
}

export interface IngestionPipeline {
  name: RetrievalPipelineName;
  ingestDocument(doc: {
    id: string;
    title: string;
    sourceType: string;
    sourceRef: string;
    text: string;
  }): Promise<void>;
  reindexAll(): Promise<void>;
}

export type IngestionDocument = {
  id: string;
  title: string;
  sourceType: string;
  sourceRef: string;
  text: string;
};

export type PipelineIngestStats = {
  documents: number;
  chunksCreated: number;
  treeNodesCreated: number;
  embeddingCostUsd: number;
  summarizationCostUsd: number;
};
