import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { config } from '../../config.js';
import { supabase } from '../../db/client.js';
import type { LibraryTreeNodeInsert } from '../../db/types.js';
import { chatCompletionCostUsd, estimateTokens, roundCost } from '../cost.js';
import { sha256 } from '../hash.js';
import type { IngestionDocument } from '../types.js';

export type TreeBuildResult = {
  nodes: LibraryTreeNodeInsert[];
  costUsd: number;
};

type DraftNode = {
  id: string;
  documentId: string;
  parentId: string | null;
  depth: number;
  position: number;
  title: string;
  contentFull: string;
  pathTitles: string[];
  children: DraftNode[];
};

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

export async function buildPageIndexTree(doc: IngestionDocument): Promise<TreeBuildResult> {
  const root: DraftNode = {
    id: randomUUID(),
    documentId: doc.id,
    parentId: null,
    depth: 0,
    position: 0,
    title: doc.title,
    contentFull: doc.text,
    pathTitles: [doc.title],
    children: [],
  };

  buildHeadingNodes(doc, root);
  splitOversizedLeaves(root);

  const flattened = flattenTree(root);
  let costUsd = 0;
  const inserts: LibraryTreeNodeInsert[] = [];

  for (const node of flattened) {
    const summary = await summarizeNode(node);
    costUsd += summary.costUsd;
    inserts.push({
      id: node.id,
      document_id: node.documentId,
      parent_id: node.parentId,
      depth: node.depth,
      position: node.position,
      title: node.title,
      content_full: node.contentFull,
      content_summary: summary.summary,
      path_titles: node.pathTitles,
      metadata: {
        source: 'page_index',
        token_estimate: estimateTokens(node.contentFull),
        has_children: node.children.length > 0,
      },
    });
  }

  return {
    nodes: inserts,
    costUsd: roundCost(costUsd),
  };
}

function buildHeadingNodes(doc: IngestionDocument, root: DraftNode): void {
  const lines = doc.text.replace(/\r\n/g, '\n').split('\n');
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);

    if (!match) {
      return [];
    }

    return [
      {
        line: index,
        level: match[1]!.length,
        title: match[2]!.trim(),
      },
    ];
  });

  if (headings.length === 0) {
    return;
  }

  const stack: Array<{ level: number; node: DraftNode }> = [{ level: 0, node: root }];

  headings.forEach((heading, headingIndex) => {
    while (stack.length > 1 && stack[stack.length - 1]!.level >= heading.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1]!.node;
    const endLine = findHeadingEndLine(headings, headingIndex, lines.length);
    const contentFull = lines.slice(heading.line, endLine).join('\n').trim();
    const node: DraftNode = {
      id: randomUUID(),
      documentId: doc.id,
      parentId: parent.id,
      depth: parent.depth + 1,
      position: parent.children.length,
      title: heading.title,
      contentFull,
      pathTitles: [...parent.pathTitles, heading.title],
      children: [],
    };

    parent.children.push(node);
    stack.push({ level: heading.level, node });
  });
}

function findHeadingEndLine(
  headings: Array<{ line: number; level: number; title: string }>,
  headingIndex: number,
  totalLines: number,
): number {
  const current = headings[headingIndex]!;

  for (let index = headingIndex + 1; index < headings.length; index += 1) {
    const candidate = headings[index]!;

    if (candidate.level <= current.level) {
      return candidate.line;
    }
  }

  return totalLines;
}

function splitOversizedLeaves(root: DraftNode): void {
  for (const node of walkDraftNodes(root)) {
    if (node.children.length > 0 || estimateTokens(node.contentFull) <= 3000) {
      continue;
    }

    const parts = splitLongText(node.contentFull, 2500);

    if (parts.length <= 1) {
      continue;
    }

    node.children = parts.map((part, index) => ({
      id: randomUUID(),
      documentId: node.documentId,
      parentId: node.id,
      depth: node.depth + 1,
      position: index,
      title: `Part ${index + 1}`,
      contentFull: part,
      pathTitles: [...node.pathTitles, `Part ${index + 1}`],
      children: [],
    }));
  }
}

function* walkDraftNodes(root: DraftNode): Generator<DraftNode> {
  yield root;

  for (const child of root.children) {
    yield* walkDraftNodes(child);
  }
}

function flattenTree(root: DraftNode): DraftNode[] {
  return [...walkDraftNodes(root)];
}

function splitLongText(text: string, maxTokens: number): string[] {
  const sentences =
    text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)?.map((item) => item.trim()) ??
    [text];
  const parts: string[] = [];
  let selected: string[] = [];
  let tokenCount = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    if (selected.length > 0 && tokenCount + sentenceTokens > maxTokens) {
      parts.push(selected.join(' ').trim());
      selected = [];
      tokenCount = 0;
    }

    selected.push(sentence);
    tokenCount += sentenceTokens;
  }

  if (selected.length > 0) {
    parts.push(selected.join(' ').trim());
  }

  return parts;
}

async function summarizeNode(node: DraftNode): Promise<{ summary: string; costUsd: number }> {
  const contentHash = sha256(
    JSON.stringify({
      model: config.PAGEINDEX_SUMMARY_MODEL,
      title: node.title,
      content: node.contentFull,
    }),
  );

  const { data: cached, error: cacheReadError } = await supabase
    .from('library_pageindex_summary_cache')
    .select('*')
    .eq('content_hash', contentHash)
    .maybeSingle();

  if (cacheReadError) {
    throw cacheReadError;
  }

  if (cached) {
    return {
      summary: cached.summary,
      costUsd: 0,
    };
  }

  const completion = await openai.chat.completions.create({
    model: config.PAGEINDEX_SUMMARY_MODEL,
    temperature: 0,
    seed: 42,
    max_tokens: 180,
    messages: [
      {
        role: 'system',
        content:
          'Summarize this methodology section in 2-3 sentences for retrieval navigation. Include concrete rules, triggers, and decisions. Do not add facts that are not present.',
      },
      {
        role: 'user',
        content: `Title: ${node.pathTitles.join(' > ')}\n\nContent:\n${node.contentFull.slice(0, 16000)}`,
      },
    ],
  });

  const summary = completion.choices[0]?.message.content?.trim() || node.contentFull.slice(0, 500);
  const costUsd = roundCost(chatCompletionCostUsd(config.PAGEINDEX_SUMMARY_MODEL, completion));
  const { error: cacheWriteError } = await supabase.from('library_pageindex_summary_cache').upsert({
    content_hash: contentHash,
    model: config.PAGEINDEX_SUMMARY_MODEL,
    summary,
    cost_usd: costUsd,
  });

  if (cacheWriteError) {
    throw cacheWriteError;
  }

  return {
    summary,
    costUsd,
  };
}
