import { existsSync, readFileSync } from 'node:fs';
import OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../config.js';
import { supabase } from '../db/client.js';
import type { LibraryDocumentRow, LibraryEvalQueryRow } from '../db/types.js';
import { chatCompletionCostUsd, roundCost } from '../rag/cost.js';
import { listLibraryDocuments } from '../rag/db.js';
import { sha256 } from '../rag/hash.js';

export type EvalDatasetItem = {
  id: string;
  query: string;
  idealAnswer: string | null;
  relevantChunkIds: string[];
  relevantNodeIds: string[];
};

type GeneratedQuestion = {
  query: string;
  ideal_answer: string;
  relevant_section_title: string;
};

const jsonlSchema = z.object({
  query: z.string().min(1),
  ideal_answer: z.string().optional(),
  relevant_section_titles: z.array(z.string()).optional(),
});

const generatedSchema = z.object({
  questions: z.array(
    z.object({
      query: z.string(),
      ideal_answer: z.string(),
      relevant_section_title: z.string(),
    }),
  ),
});

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

export async function loadEvalDataset(): Promise<EvalDatasetItem[]> {
  if (config.EVAL_DATASET_PATH && existsSync(config.EVAL_DATASET_PATH)) {
    return loadJsonlDataset(config.EVAL_DATASET_PATH);
  }

  return loadOrGenerateSyntheticDataset();
}

async function loadJsonlDataset(path: string): Promise<EvalDatasetItem[]> {
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items: EvalDatasetItem[] = [];

  for (const line of lines) {
    const parsed = jsonlSchema.parse(JSON.parse(line));
    const note = `jsonl:${sha256(line)}`;
    const relevant = await resolveRelevantIds(parsed.relevant_section_titles ?? []);
    const row = await getOrCreateEvalQuery({
      query: parsed.query,
      idealAnswer: parsed.ideal_answer ?? null,
      relevantChunkIds: relevant.chunkIds,
      relevantNodeIds: relevant.nodeIds,
      source: 'human',
      notes: note,
    });

    items.push(rowToDatasetItem(row));
  }

  return items;
}

async function loadOrGenerateSyntheticDataset(): Promise<EvalDatasetItem[]> {
  const documents = await listLibraryDocuments();

  if (documents.length === 0) {
    throw new Error('No library documents found. Run pnpm ingest before pnpm eval.');
  }

  const rows: LibraryEvalQueryRow[] = [];

  for (const document of documents) {
    const note = `synthetic:${document.content_hash}`;
    const existing = await listEvalQueriesByNotes(note);

    if (existing.length >= 6) {
      rows.push(...existing.slice(0, 6));
      continue;
    }

    const generated = await generateQuestionsForDocument(document);

    for (const question of generated) {
      const relevant = await resolveRelevantIds([question.relevant_section_title]);
      const row = await getOrCreateEvalQuery({
        query: question.query,
        idealAnswer: question.ideal_answer,
        relevantChunkIds: relevant.chunkIds,
        relevantNodeIds: relevant.nodeIds,
        source: 'synthetic',
        notes: note,
      });
      rows.push(row);
    }
  }

  return rows.slice(0, 50).map(rowToDatasetItem);
}

async function generateQuestionsForDocument(document: LibraryDocumentRow): Promise<GeneratedQuestion[]> {
  const completion = await openai.chat.completions.create({
    model: config.EVAL_JUDGE_MODEL,
    temperature: 0,
    seed: 42,
    response_format: { type: 'json_object' },
    max_tokens: 1400,
    messages: [
      {
        role: 'system',
        content:
          'Generate realistic caller methodology eval questions. Return JSON only: { "questions": [{ "query": string, "ideal_answer": string, "relevant_section_title": string }] }.',
      },
      {
        role: 'user',
        content: `Document title: ${document.title}\n\nGenerate 6 question/answer pairs from this document. Use section titles exactly when possible.\n\n${document.raw_text}`,
      },
    ],
  });
  const cost = roundCost(chatCompletionCostUsd(config.EVAL_JUDGE_MODEL, completion));
  const raw = completion.choices[0]?.message.content ?? '{}';

  try {
    const parsed = generatedSchema.parse(JSON.parse(raw));
    return parsed.questions.slice(0, 6);
  } catch {
    return fallbackQuestions(document).map((question) => ({
      ...question,
      ideal_answer: `${question.ideal_answer} (fallback generated locally; LLM generation cost estimate was ${cost})`,
    }));
  }
}

function fallbackQuestions(document: LibraryDocumentRow): GeneratedQuestion[] {
  const titles = [...document.raw_text.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]!.trim());
  const selected = titles.length > 0 ? titles.slice(0, 6) : [document.title];

  return selected.map((title) => ({
    query: `What should I do for ${title.toLowerCase()}?`,
    ideal_answer: `Use the guidance in ${title}.`,
    relevant_section_title: title,
  }));
}

async function getOrCreateEvalQuery(input: {
  query: string;
  idealAnswer: string | null;
  relevantChunkIds: string[];
  relevantNodeIds: string[];
  source: 'synthetic' | 'human';
  notes: string;
}): Promise<LibraryEvalQueryRow> {
  const { data: existing, error: readError } = await supabase
    .from('library_eval_queries')
    .select('*')
    .eq('notes', input.notes)
    .eq('query', input.query)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from('library_eval_queries')
    .insert({
      query: input.query,
      ideal_answer: input.idealAnswer,
      relevant_chunk_ids: input.relevantChunkIds,
      relevant_node_ids: input.relevantNodeIds,
      source: input.source,
      notes: input.notes,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function listEvalQueriesByNotes(notes: string): Promise<LibraryEvalQueryRow[]> {
  const { data, error } = await supabase
    .from('library_eval_queries')
    .select('*')
    .eq('notes', notes)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function resolveRelevantIds(sectionTitles: string[]): Promise<{ chunkIds: string[]; nodeIds: string[] }> {
  if (sectionTitles.length === 0) {
    return { chunkIds: [], nodeIds: [] };
  }

  const normalized = sectionTitles.map((title) => title.trim().toLowerCase()).filter(Boolean);
  const [{ data: chunks, error: chunksError }, { data: nodes, error: nodesError }] = await Promise.all([
    supabase.from('library_chunks').select('id,section_path,metadata'),
    supabase.from('library_tree_nodes').select('id,title,path_titles'),
  ]);

  if (chunksError) {
    throw chunksError;
  }

  if (nodesError) {
    throw nodesError;
  }

  return {
    chunkIds: (chunks ?? [])
      .filter((chunk) => normalized.some((title) => (chunk.section_path ?? '').toLowerCase().includes(title)))
      .map((chunk) => chunk.id),
    nodeIds: (nodes ?? [])
      .filter((node) =>
        normalized.some((title) =>
          [node.title, ...node.path_titles].some((part) => part.toLowerCase().includes(title)),
        ),
      )
      .map((node) => node.id),
  };
}

function rowToDatasetItem(row: LibraryEvalQueryRow): EvalDatasetItem {
  return {
    id: row.id,
    query: row.query,
    idealAnswer: row.ideal_answer,
    relevantChunkIds: row.relevant_chunk_ids ?? [],
    relevantNodeIds: row.relevant_node_ids ?? [],
  };
}
