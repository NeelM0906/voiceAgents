import { supabase } from '../../db/client.js';
import { documentRowToIngestionDocument, listLibraryDocuments } from '../db.js';
import type { IngestionDocument, IngestionPipeline, PipelineIngestStats } from '../types.js';
import { chunkMarkdownDocument } from './chunker.js';
import { embedTexts, toVectorLiteral } from './embed.js';

export class HybridIngestionPipeline implements IngestionPipeline {
  name = 'hybrid' as const;

  async ingestDocument(doc: IngestionDocument): Promise<void> {
    await ingestHybridDocument(doc);
  }

  async reindexAll(): Promise<void> {
    const documents = await listLibraryDocuments();

    for (const document of documents) {
      await ingestHybridDocument(documentRowToIngestionDocument(document));
    }
  }
}

export async function ingestHybridDocument(doc: IngestionDocument): Promise<PipelineIngestStats> {
  const chunks = chunkMarkdownDocument({
    title: doc.title,
    text: doc.text,
  });

  const { error: deleteError } = await supabase
    .from('library_chunks')
    .delete()
    .eq('document_id', doc.id);

  if (deleteError) {
    throw deleteError;
  }

  if (chunks.length === 0) {
    return {
      documents: 1,
      chunksCreated: 0,
      treeNodesCreated: 0,
      embeddingCostUsd: 0,
      summarizationCostUsd: 0,
    };
  }

  const embeddingResult = await embedTexts(chunks.map((chunk) => chunk.content));
  const rows = chunks.map((chunk, index) => ({
    document_id: doc.id,
    position: chunk.position,
    section_path: chunk.sectionPath.join(' > '),
    content: chunk.content,
    embedding: toVectorLiteral(embeddingResult.embeddings[index]!),
    metadata: {
      title: doc.title,
      source_type: doc.sourceType,
      source_ref: doc.sourceRef,
      section_path: chunk.sectionPath,
      token_estimate: chunk.tokenEstimate,
    },
  }));

  const { error: insertError } = await supabase.from('library_chunks').insert(rows);

  if (insertError) {
    throw insertError;
  }

  return {
    documents: 1,
    chunksCreated: rows.length,
    treeNodesCreated: 0,
    embeddingCostUsd: embeddingResult.costUsd,
    summarizationCostUsd: 0,
  };
}
