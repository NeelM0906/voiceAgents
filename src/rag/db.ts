import { supabase } from '../db/client.js';
import type {
  LibraryDocumentInsert,
  LibraryDocumentRow,
  LibraryTreeNodeRow,
  RagPipelineName,
} from '../db/types.js';
import type { IngestionDocument } from './types.js';
import { sha256 } from './hash.js';

export async function findDocumentBySourceHash(input: {
  sourceRef: string;
  contentHash: string;
}): Promise<LibraryDocumentRow | null> {
  const { data, error } = await supabase
    .from('library_documents')
    .select('*')
    .eq('source_ref', input.sourceRef)
    .eq('content_hash', input.contentHash)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function createLibraryDocument(input: LibraryDocumentInsert): Promise<LibraryDocumentRow> {
  const { data, error } = await supabase
    .from('library_documents')
    .upsert(input, { onConflict: 'source_ref,content_hash', ignoreDuplicates: false })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function listLibraryDocuments(): Promise<LibraryDocumentRow[]> {
  const { data, error } = await supabase
    .from('library_documents')
    .select('*')
    .order('ingested_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function deleteLibraryDocument(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('library_documents')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    throw error;
  }

  return (data ?? []).length > 0;
}

export async function countDocumentChunks(documentId: string): Promise<number> {
  const { count, error } = await supabase
    .from('library_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export async function countDocumentNodes(documentId: string): Promise<number> {
  const { count, error } = await supabase
    .from('library_tree_nodes')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export async function getTreeRevision(): Promise<string> {
  const [documents, nodes] = await Promise.all([
    listLibraryDocuments(),
    supabase
      .from('library_tree_nodes')
      .select('id,document_id,created_at')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  if (nodes.error) {
    throw nodes.error;
  }

  return sha256(
    JSON.stringify({
      documents: documents.map((doc) => ({
        id: doc.id,
        hash: doc.content_hash,
      })),
      latestNode: nodes.data?.[0] ?? null,
    }),
  );
}

export async function getTreeNodesByIds(ids: string[]): Promise<LibraryTreeNodeRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('library_tree_nodes')
    .select('*')
    .in('id', ids);

  if (error) {
    throw error;
  }

  const byId = new Map((data ?? []).map((node) => [node.id, node]));
  return ids.flatMap((id) => {
    const node = byId.get(id);
    return node ? [node] : [];
  });
}

export function documentRowToIngestionDocument(row: LibraryDocumentRow): IngestionDocument {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    text: row.raw_text,
  };
}

export function getPipelineConfigSnapshot(pipeline: RagPipelineName): Record<string, unknown> {
  return {
    pipeline,
    ragWinner: process.env.RAG_WINNER,
    ragTopK: process.env.RAG_TOP_K,
    openaiEmbedModel: process.env.OPENAI_EMBED_MODEL,
    hybridHydeEnabled: process.env.HYBRID_HYDE_ENABLED,
    hybridHydeModel: process.env.HYBRID_HYDE_MODEL,
    hybridRerankEnabled: process.env.HYBRID_RERANK_ENABLED,
    cohereRerankModel: process.env.COHERE_RERANK_MODEL,
    pageindexNavigatorModel: process.env.PAGEINDEX_NAVIGATOR_MODEL,
    pageindexSummaryModel: process.env.PAGEINDEX_SUMMARY_MODEL,
    pageindexMaxDepth: process.env.PAGEINDEX_MAX_DEPTH,
    pageindexMaxFanout: process.env.PAGEINDEX_MAX_FANOUT,
  };
}
