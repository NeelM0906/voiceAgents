import { supabase } from '../../db/client.js';
import { documentRowToIngestionDocument, listLibraryDocuments } from '../db.js';
import type { IngestionDocument, IngestionPipeline, PipelineIngestStats } from '../types.js';
import { buildPageIndexTree } from './tree_builder.js';

export class PageIndexIngestionPipeline implements IngestionPipeline {
  name = 'page_index' as const;

  async ingestDocument(doc: IngestionDocument): Promise<void> {
    await ingestPageIndexDocument(doc);
  }

  async reindexAll(): Promise<void> {
    const documents = await listLibraryDocuments();

    for (const document of documents) {
      await ingestPageIndexDocument(documentRowToIngestionDocument(document));
    }
  }
}

export async function ingestPageIndexDocument(doc: IngestionDocument): Promise<PipelineIngestStats> {
  const { nodes, costUsd } = await buildPageIndexTree(doc);
  const { error: deleteError } = await supabase
    .from('library_tree_nodes')
    .delete()
    .eq('document_id', doc.id);

  if (deleteError) {
    throw deleteError;
  }

  if (nodes.length === 0) {
    return {
      documents: 1,
      chunksCreated: 0,
      treeNodesCreated: 0,
      embeddingCostUsd: 0,
      summarizationCostUsd: costUsd,
    };
  }

  const { error: insertError } = await supabase.from('library_tree_nodes').insert(nodes);

  if (insertError) {
    throw insertError;
  }

  return {
    documents: 1,
    chunksCreated: 0,
    treeNodesCreated: nodes.length,
    embeddingCostUsd: 0,
    summarizationCostUsd: costUsd,
  };
}
