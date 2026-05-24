import { config } from '../config.js';
import { supabase } from '../db/client.js';
import type { Json, RagPipelineName } from '../db/types.js';
import { getRetrievalPipeline } from '../rag/active.js';
import { getPipelineConfigSnapshot } from '../rag/db.js';
import type { RetrievalPipelineName } from '../rag/types.js';
import { loadEvalDataset, type EvalDatasetItem } from './dataset.js';
import { buildGroundedAnswer, judgeAnswer } from './judge.js';
import { computeRetrievalMetrics } from './metrics.js';
import {
  writeMarkdownReport,
  type PerQueryReport,
  type PipelineSummary,
} from './report.js';

export type RunEvalOptions = {
  pipelines?: RetrievalPipelineName[];
  runIds?: Partial<Record<RetrievalPipelineName, string>>;
};

export type RunEvalResult = {
  reportPath: string;
  summaries: PipelineSummary[];
};

type PipelineRunAccumulator = {
  runId: string;
  pipeline: RetrievalPipelineName;
  config: Record<string, unknown>;
  datasetSize: number;
  judgeScores: number[];
  recallAt5: number[];
  recallAt8: number[];
  mrr: number[];
  ndcgAt10: number[];
  latencies: number[];
  totalCostUsd: number;
};

export async function runEval(options?: RunEvalOptions): Promise<RunEvalResult> {
  const startedAt = new Date();
  const pipelines = options?.pipelines ?? ['hybrid', 'page_index'];
  const dataset = await loadEvalDataset();
  const summaries: PipelineSummary[] = [];
  const queryReports: PerQueryReport[] = [];

  for (const pipelineName of pipelines) {
    const accumulator = await runPipeline({
      pipelineName,
      dataset,
      existingRunId: options?.runIds?.[pipelineName],
      queryReports,
    });
    const summary = summarize(accumulator);
    summaries.push(summary);
    await completeRun(summary);
  }

  const completedAt = new Date();
  const reportPath = writeMarkdownReport({
    startedAt,
    completedAt,
    summaries,
    queries: queryReports,
  });

  return {
    reportPath,
    summaries,
  };
}

export async function createQueuedEvalRuns(
  pipelines: RetrievalPipelineName[],
): Promise<Partial<Record<RetrievalPipelineName, string>>> {
  const runIds: Partial<Record<RetrievalPipelineName, string>> = {};

  for (const pipeline of pipelines) {
    const { data, error } = await supabase
      .from('library_eval_runs')
      .insert({
        pipeline: pipeline as RagPipelineName,
        config: getPipelineConfigSnapshot(pipeline) as Json,
        dataset_size: 0,
        summary: {
          status: 'queued',
        },
      })
      .select('id')
      .single();

    if (error) {
      throw error;
    }

    runIds[pipeline] = data.id;
  }

  return runIds;
}

async function runPipeline(input: {
  pipelineName: RetrievalPipelineName;
  dataset: EvalDatasetItem[];
  existingRunId?: string;
  queryReports: PerQueryReport[];
}): Promise<PipelineRunAccumulator> {
  const pipeline = getRetrievalPipeline(input.pipelineName);
  const runId =
    input.existingRunId ??
    (await createRun({
      pipeline: input.pipelineName,
      datasetSize: input.dataset.length,
    }));
  const accumulator: PipelineRunAccumulator = {
    runId,
    pipeline: input.pipelineName,
    config: getPipelineConfigSnapshot(input.pipelineName),
    datasetSize: input.dataset.length,
    judgeScores: [],
    recallAt5: [],
    recallAt8: [],
    mrr: [],
    ndcgAt10: [],
    latencies: [],
    totalCostUsd: 0,
  };

  await supabase
    .from('library_eval_runs')
    .update({
      dataset_size: input.dataset.length,
      summary: {
        status: 'running',
      },
    })
    .eq('id', runId);

  for (const item of input.dataset) {
    const retrieval = await pipeline.retrieve(item.query, { k: 10 });
    const relevantIds = input.pipelineName === 'hybrid' ? item.relevantChunkIds : item.relevantNodeIds;
    const metrics = computeRetrievalMetrics({
      results: retrieval.results,
      relevantIds,
    });
    const answer = await buildGroundedAnswer({
      query: item.query,
      results: retrieval.results,
    });
    const retrievedContext = retrieval.results.map((result) => result.content).join('\n\n---\n\n');
    const judge = await judgeAnswer({
      query: item.query,
      idealAnswer: item.idealAnswer,
      retrievedContext,
      generatedAnswer: answer.answer,
    });
    const costUsd = retrieval.costUsd + answer.costUsd + judge.costUsd;

    accumulator.totalCostUsd += costUsd;
    accumulator.latencies.push(retrieval.latencyMs);
    pushIfNumber(accumulator.judgeScores, judge.score);
    pushIfNumber(accumulator.recallAt5, metrics.recallAt5);
    pushIfNumber(accumulator.recallAt8, metrics.recallAt8);
    pushIfNumber(accumulator.mrr, metrics.mrr);
    pushIfNumber(accumulator.ndcgAt10, metrics.ndcgAt10);

    await insertResult({
      runId,
      queryId: item.id,
      retrieved: retrieval.results.map((result) => ({
        id: result.chunkOrNodeId,
        document_id: result.documentId,
        score: result.score,
        path: result.path,
        metadata: result.metadata,
      })),
      latencyMs: retrieval.latencyMs,
      costUsd,
      recallAt5: metrics.recallAt5,
      recallAt8: metrics.recallAt8,
      mrr: metrics.mrr,
      ndcgAt10: metrics.ndcgAt10,
      judgeScore: judge.score,
      judgeReasoning: judge.reasoning,
    });

    input.queryReports.push({
      pipeline: input.pipelineName,
      runId,
      queryId: item.id,
      query: item.query,
      idealAnswer: item.idealAnswer,
      generatedAnswer: answer.answer,
      judgeScore: judge.score,
      judgeReasoning: judge.reasoning,
      latencyMs: retrieval.latencyMs,
      costUsd,
    });
  }

  return accumulator;
}

async function createRun(input: {
  pipeline: RetrievalPipelineName;
  datasetSize: number;
}): Promise<string> {
  const { data, error } = await supabase
    .from('library_eval_runs')
    .insert({
      pipeline: input.pipeline as RagPipelineName,
      config: getPipelineConfigSnapshot(input.pipeline) as Json,
      dataset_size: input.datasetSize,
    })
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function insertResult(input: {
  runId: string;
  queryId: string;
  retrieved: unknown;
  latencyMs: number;
  costUsd: number;
  recallAt5: number | null;
  recallAt8: number | null;
  mrr: number | null;
  ndcgAt10: number | null;
  judgeScore: number | null;
  judgeReasoning: string | null;
}): Promise<void> {
  const { error } = await supabase.from('library_eval_results').insert({
    run_id: input.runId,
    query_id: input.queryId,
    retrieved: input.retrieved as Json,
    latency_ms: input.latencyMs,
    cost_usd: Number(input.costUsd.toFixed(6)),
    recall_at_5: input.recallAt5,
    recall_at_8: input.recallAt8,
    mrr: input.mrr,
    ndcg_at_10: input.ndcgAt10,
    judge_score: input.judgeScore,
    judge_reasoning: input.judgeReasoning,
  });

  if (error) {
    throw error;
  }
}

async function completeRun(summary: PipelineSummary): Promise<void> {
  const { error } = await supabase
    .from('library_eval_runs')
    .update({
      completed_at: new Date().toISOString(),
      summary: summary as unknown as Json,
    })
    .eq('id', summary.runId);

  if (error) {
    throw error;
  }
}

function summarize(accumulator: PipelineRunAccumulator): PipelineSummary {
  return {
    pipeline: accumulator.pipeline,
    runId: accumulator.runId,
    config: accumulator.config,
    datasetSize: accumulator.datasetSize,
    meanJudgeScore: meanOrNull(accumulator.judgeScores),
    meanRecallAt5: meanOrNull(accumulator.recallAt5),
    meanRecallAt8: meanOrNull(accumulator.recallAt8),
    meanMrr: meanOrNull(accumulator.mrr),
    meanNdcgAt10: meanOrNull(accumulator.ndcgAt10),
    p50LatencyMs: percentile(accumulator.latencies, 50),
    p95LatencyMs: percentile(accumulator.latencies, 95),
    totalCostUsd: Number(accumulator.totalCostUsd.toFixed(6)),
  };
}

function pushIfNumber(values: number[], value: number | null): void {
  if (value !== null && Number.isFinite(value)) {
    values.push(value);
  }
}

function meanOrNull(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index]!;
}
