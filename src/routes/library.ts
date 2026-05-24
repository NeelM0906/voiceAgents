import { Hono } from 'hono';
import { z } from 'zod';
import { supabase } from '../db/client.js';
import type { RagPipelineName } from '../db/types.js';
import { createQueuedEvalRuns, runEval } from '../eval/runner.js';
import {
  countDocumentChunks,
  countDocumentNodes,
  deleteLibraryDocument,
  listLibraryDocuments,
} from '../rag/db.js';
import { getRetrievalPipeline } from '../rag/active.js';
import type { RetrievalPipelineName } from '../rag/types.js';
import { logger } from '../logger.js';
import { handleAdminRouteError, parseJsonBody } from './admin-utils.js';

const apiLogger = logger.child({ component: 'admin-api', route: 'library' });

const pipelineSchema = z.enum(['hybrid', 'page_index']);

const searchSchema = z.object({
  query: z.string().trim().min(1).max(200),
  top_k: z.number().int().min(1).max(10).optional(),
  pipeline: pipelineSchema.optional(),
});

const evalRunSchema = z.object({
  pipelines: z.array(pipelineSchema).min(1).max(2).optional(),
});

export const libraryRoutes = new Hono();

libraryRoutes.get('/documents', async (c) => {
  try {
    const documents = await listLibraryDocuments();
    const rows = await Promise.all(
      documents.map(async (document) => {
        const [chunkCount, nodeCount] = await Promise.all([
          countDocumentChunks(document.id),
          countDocumentNodes(document.id),
        ]);

        return {
          id: document.id,
          title: document.title,
          source_type: document.source_type,
          source_ref: document.source_ref,
          ingested_at: document.ingested_at,
          chunk_count: chunkCount,
          node_count: nodeCount,
        };
      }),
    );

    return c.json({ documents: rows });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

libraryRoutes.delete('/documents/:id', async (c) => {
  try {
    const deleted = await deleteLibraryDocument(c.req.param('id'));

    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }

    return c.body(null, 204);
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

libraryRoutes.post('/search', async (c) => {
  const parsed = await parseJsonBody(c, searchSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const pipeline = getRetrievalPipeline(parsed.data.pipeline);
    const response = await pipeline.retrieve(parsed.data.query, {
      k: parsed.data.top_k,
    });

    return c.json({
      pipeline: pipeline.name,
      results: response.results,
      latencyMs: response.latencyMs,
      costUsd: response.costUsd,
    });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

libraryRoutes.post('/eval/run', async (c) => {
  const parsed = await parseJsonBody(c, evalRunSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const pipelines = (parsed.data.pipelines ?? ['hybrid', 'page_index']) as RetrievalPipelineName[];

  try {
    const runIds = await createQueuedEvalRuns(pipelines);

    void runEval({ pipelines, runIds }).catch((error) => {
      apiLogger.error({ error, runIds }, 'background library eval failed');
    });

    return c.json({ run_ids: runIds }, 202);
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

libraryRoutes.get('/eval/runs', async (c) => {
  const limit = parseLimit(c.req.query('limit'), 20, 100);

  if (!limit.ok) {
    return c.json({ error: 'invalid_request', message: limit.message }, 400);
  }

  try {
    const { data, error } = await supabase
      .from('library_eval_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit.value);

    if (error) {
      throw error;
    }

    return c.json({ runs: data ?? [] });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

libraryRoutes.get('/eval/runs/:id', async (c) => {
  try {
    const [{ data: run, error: runError }, { data: results, error: resultsError }] = await Promise.all([
      supabase.from('library_eval_runs').select('*').eq('id', c.req.param('id')).maybeSingle(),
      supabase
        .from('library_eval_results')
        .select('*')
        .eq('run_id', c.req.param('id'))
        .order('created_at', { ascending: true }),
    ]);

    if (runError) {
      throw runError;
    }

    if (resultsError) {
      throw resultsError;
    }

    if (!run) {
      return c.json({ error: 'not_found' }, 404);
    }

    return c.json({ run, results: results ?? [] });
  } catch (error) {
    return handleAdminRouteError(c, error);
  }
});

type LimitResult =
  | {
      ok: true;
      value: number;
    }
  | {
      ok: false;
      message: string;
    };

function parseLimit(value: string | undefined, defaultValue: number, maxValue: number): LimitResult {
  if (value === undefined) {
    return {
      ok: true,
      value: defaultValue,
    };
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxValue) {
    return {
      ok: false,
      message: `limit must be an integer from 1 to ${maxValue}`,
    };
  }

  return {
    ok: true,
    value: parsed,
  };
}
