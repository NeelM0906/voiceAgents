import OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../../config.js';
import { supabase } from '../../db/client.js';
import type { Json, LibraryTreeNodeRow } from '../../db/types.js';
import { chatCompletionCostUsd, roundCost } from '../cost.js';
import { getTreeNodesByIds, getTreeRevision } from '../db.js';
import { sha256 } from '../hash.js';

export type NavigationResult = {
  nodes: LibraryTreeNodeRow[];
  costUsd: number;
  trace: {
    cacheHit: boolean;
    treeRevision: string;
    hops: Array<Record<string, unknown>>;
  };
};

type NavigationContextNode = {
  id: string;
  title: string;
  summary: string;
};

const navigatorSchema = z.object({
  action: z.enum(['pick', 'stop']),
  ids: z.array(z.string()).default([]),
  reasoning: z.string().optional(),
});

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

export async function navigatePageIndex(query: string): Promise<NavigationResult> {
  const treeRevision = await getTreeRevision();
  const queryHash = sha256(query.trim().toLowerCase());
  const cached = await readNavCache(queryHash, treeRevision);

  if (cached) {
    return {
      nodes: await getTreeNodesByIds(cached.result_node_ids),
      costUsd: 0,
      trace: {
        cacheHit: true,
        treeRevision,
        hops: [{ source: 'cache', nodeIds: cached.result_node_ids }],
      },
    };
  }

  const roots = await loadChildren(null);
  const trace: Array<Record<string, unknown>> = [];
  const selected = new Map<string, LibraryTreeNodeRow>();
  let costUsd = 0;

  await walk({
    query,
    parent: null,
    children: roots,
    depth: 0,
    selected,
    trace,
    costUsdRef: {
      add(cost) {
        costUsd += cost;
      },
    },
  });

  const nodes = [...selected.values()];

  await writeNavCache({
    queryHash,
    treeRevision,
    nodeIds: nodes.map((node) => node.id),
    trace,
    costUsd,
  });

  return {
    nodes,
    costUsd: roundCost(costUsd),
    trace: {
      cacheHit: false,
      treeRevision,
      hops: trace,
    },
  };
}

async function walk(input: {
  query: string;
  parent: LibraryTreeNodeRow | null;
  children: LibraryTreeNodeRow[];
  depth: number;
  selected: Map<string, LibraryTreeNodeRow>;
  trace: Array<Record<string, unknown>>;
  costUsdRef: { add(cost: number): void };
}): Promise<void> {
  if (input.children.length === 0 || input.depth >= config.PAGEINDEX_MAX_DEPTH) {
    if (input.parent) {
      input.selected.set(input.parent.id, input.parent);
    }
    return;
  }

  const decision = await chooseChildren({
    query: input.query,
    parent: input.parent,
    children: input.children.map(toContextNode),
    allowStop: input.parent !== null,
  });
  input.costUsdRef.add(decision.costUsd);
  input.trace.push({
    parentId: input.parent?.id ?? 'library',
    parentTitle: input.parent?.title ?? 'Library',
    action: decision.action,
    ids: decision.ids,
    reasoning: decision.reasoning,
  });

  if (decision.action === 'stop' && input.parent) {
    input.selected.set(input.parent.id, input.parent);
    return;
  }

  const chosen = input.children
    .filter((child) => decision.ids.includes(child.id))
    .slice(0, config.PAGEINDEX_MAX_FANOUT);

  if (chosen.length === 0) {
    const fallback = input.children.slice(0, Math.min(config.PAGEINDEX_MAX_FANOUT, input.children.length));
    chosen.push(...fallback);
  }

  await Promise.all(
    chosen.map(async (node) => {
      const children = await loadChildren(node.id);

      if (children.length === 0) {
        input.selected.set(node.id, node);
        return;
      }

      await walk({
        ...input,
        parent: node,
        children,
        depth: input.depth + 1,
      });
    }),
  );
}

async function chooseChildren(input: {
  query: string;
  parent: LibraryTreeNodeRow | null;
  children: NavigationContextNode[];
  allowStop: boolean;
}): Promise<{ action: 'pick' | 'stop'; ids: string[]; reasoning?: string; costUsd: number }> {
  const completion = await openai.chat.completions.create({
    model: config.PAGEINDEX_NAVIGATOR_MODEL,
    temperature: 0,
    seed: 42,
    response_format: { type: 'json_object' },
    max_tokens: 220,
    messages: [
      {
        role: 'system',
        content:
          'You navigate a hierarchical methodology library. Given a query and child nodes, choose the 1-3 child ids most relevant to answer the query. Return STOP only when the current node is already sufficient. Output JSON only: {"action":"pick","ids":["..."],"reasoning":"..."} or {"action":"stop","ids":[],"reasoning":"..."}.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          query: input.query,
          current_node: input.parent
            ? {
                id: input.parent.id,
                title: input.parent.title,
                path: input.parent.path_titles,
                summary: input.parent.content_summary,
              }
            : {
                id: 'library',
                title: 'Library',
                path: [],
                summary: 'Root list of methodology documents. STOP is not allowed at this level.',
              },
          allow_stop: input.allowStop,
          children: input.children,
          max_ids: config.PAGEINDEX_MAX_FANOUT,
        }),
      },
    ],
  });

  const raw = completion.choices[0]?.message.content ?? '{}';
  const parsed = safeParseNavigatorResponse(raw);

  if (!parsed.success) {
    return {
      action: 'pick',
      ids: input.children.slice(0, config.PAGEINDEX_MAX_FANOUT).map((child) => child.id),
      reasoning: 'Navigator response did not match schema; used ordered fallback.',
      costUsd: roundCost(chatCompletionCostUsd(config.PAGEINDEX_NAVIGATOR_MODEL, completion)),
    };
  }

  const ids = parsed.data.ids.filter((id) => input.children.some((child) => child.id === id));
  const action = parsed.data.action === 'stop' && input.allowStop ? 'stop' : 'pick';

  return {
    action,
    ids: ids.slice(0, config.PAGEINDEX_MAX_FANOUT),
    reasoning: parsed.data.reasoning,
    costUsd: roundCost(chatCompletionCostUsd(config.PAGEINDEX_NAVIGATOR_MODEL, completion)),
  };
}

function safeParseNavigatorResponse(raw: string): ReturnType<typeof navigatorSchema.safeParse> {
  try {
    return navigatorSchema.safeParse(JSON.parse(raw));
  } catch {
    return navigatorSchema.safeParse({});
  }
}

async function loadChildren(parentId: string | null): Promise<LibraryTreeNodeRow[]> {
  let query = supabase
    .from('library_tree_nodes')
    .select('*')
    .order('position', { ascending: true });

  query = parentId === null ? query.is('parent_id', null) : query.eq('parent_id', parentId);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data ?? [];
}

function toContextNode(node: LibraryTreeNodeRow): NavigationContextNode {
  return {
    id: node.id,
    title: node.title,
    summary: node.content_summary,
  };
}

async function readNavCache(queryHash: string, treeRevision: string) {
  const { data, error } = await supabase
    .from('library_pageindex_nav_cache')
    .select('*')
    .eq('query_hash', queryHash)
    .eq('tree_revision', treeRevision)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function writeNavCache(input: {
  queryHash: string;
  treeRevision: string;
  nodeIds: string[];
  trace: Array<Record<string, unknown>>;
  costUsd: number;
}): Promise<void> {
  const { error } = await supabase.from('library_pageindex_nav_cache').upsert({
    query_hash: input.queryHash,
    tree_revision: input.treeRevision,
    result_node_ids: input.nodeIds,
    trace: input.trace as Json,
    cost_usd: roundCost(input.costUsd),
  });

  if (error) {
    throw error;
  }
}
