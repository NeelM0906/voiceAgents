import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import fg from 'fast-glob';
import {
  countDocumentChunks,
  createLibraryDocument,
  documentRowToIngestionDocument,
  findDocumentBySourceHash,
  listLibraryDocuments,
} from '../rag/db.js';
import { ingestHybridDocument } from '../rag/hybrid/ingest.js';
import { sha256 } from '../rag/hash.js';
import type { PipelineIngestStats } from '../rag/types.js';

type CliOptions = {
  reindex: boolean;
  patterns: string[];
};

const options = parseArgs(process.argv.slice(2));

try {
  if (options.reindex && options.patterns.length === 0) {
    await reindexAllDocuments();
  } else {
    await ingestPaths(options.patterns, options.reindex);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function ingestPaths(patterns: string[], forceReindex: boolean): Promise<void> {
  if (patterns.length === 0) {
    throw new Error('Usage: pnpm ingest <path-or-glob> [more paths]');
  }

  const files = await resolveMarkdownFiles(patterns);

  if (files.length === 0) {
    throw new Error('No markdown files matched the provided path or glob.');
  }

  let summary = emptyStats();
  let skipped = 0;

  for (const file of files) {
    const rawText = readFileSync(file, 'utf8');
    const contentHash = sha256(rawText);
    const sourceRef = normalizeSourceRef(file);
    const title = extractTitle(rawText, sourceRef);
    const existing = await findDocumentBySourceHash({ sourceRef, contentHash });

    if (existing && !forceReindex) {
      const chunkCount = await countDocumentChunks(existing.id);

      if (chunkCount > 0) {
        skipped += 1;
        continue;
      }
    }

    const document = existing ?? (await createLibraryDocument({
      title,
      source_type: 'markdown',
      source_ref: sourceRef,
      content_hash: contentHash,
      raw_text: rawText,
      metadata: {
        title,
      },
    }));
    const ingestionDocument = documentRowToIngestionDocument(document);
    const hybridStats = await ingestHybridDocument(ingestionDocument);

    summary.documents += 1;
    summary = addStats(summary, hybridStats);
  }

  printSummary(summary, skipped);
}

async function reindexAllDocuments(): Promise<void> {
  const documents = await listLibraryDocuments();
  let summary = emptyStats();

  for (const document of documents) {
    const ingestionDocument = documentRowToIngestionDocument(document);
    const hybridStats = await ingestHybridDocument(ingestionDocument);

    summary.documents += 1;
    summary = addStats(summary, hybridStats);
  }

  printSummary(summary, 0);
}

async function resolveMarkdownFiles(patterns: string[]): Promise<string[]> {
  const expanded: string[] = [];

  for (const pattern of patterns) {
    const absolute = resolve(pattern);

    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      expanded.push(`${absolute.replace(/\\/g, '/')}/**/*.md`);
      continue;
    }

    if (existsSync(absolute) && statSync(absolute).isFile()) {
      expanded.push(absolute);
      continue;
    }

    expanded.push(pattern);
  }

  const matches = await fg(expanded, {
    absolute: true,
    onlyFiles: true,
    unique: true,
  });

  return matches.filter((file) => file.toLowerCase().endsWith('.md')).sort();
}

function parseArgs(args: string[]): CliOptions {
  const reindex = args.includes('--reindex');

  return {
    reindex,
    patterns: args.filter((arg) => arg !== '--reindex'),
  };
}

function normalizeSourceRef(file: string): string {
  return relative(process.cwd(), file).replace(/\\/g, '/');
}

function extractTitle(text: string, sourceRef: string): string {
  const heading = /^#\s+(.+?)\s*$/m.exec(text);

  if (heading?.[1]) {
    return heading[1].trim();
  }

  return sourceRef.split('/').at(-1)?.replace(/\.md$/i, '') ?? sourceRef;
}

function emptyStats(): PipelineIngestStats {
  return {
    documents: 0,
    chunksCreated: 0,
    treeNodesCreated: 0,
    embeddingCostUsd: 0,
    summarizationCostUsd: 0,
  };
}

function addStats(left: PipelineIngestStats, right: PipelineIngestStats): PipelineIngestStats {
  return {
    documents: left.documents,
    chunksCreated: left.chunksCreated + right.chunksCreated,
    treeNodesCreated: left.treeNodesCreated + right.treeNodesCreated,
    embeddingCostUsd: left.embeddingCostUsd + right.embeddingCostUsd,
    summarizationCostUsd: left.summarizationCostUsd + right.summarizationCostUsd,
  };
}

function printSummary(summary: PipelineIngestStats, skipped: number): void {
  console.log(
    JSON.stringify(
      {
        documents: summary.documents,
        skipped,
        chunks_created: summary.chunksCreated,
        tree_nodes_created: summary.treeNodesCreated,
        embedding_cost_usd: Number(summary.embeddingCostUsd.toFixed(6)),
        summarization_cost_usd: Number(summary.summarizationCostUsd.toFixed(6)),
      },
      null,
      2,
    ),
  );
}
