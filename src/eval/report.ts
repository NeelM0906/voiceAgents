import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RetrievalPipelineName } from '../rag/types.js';

export type PipelineSummary = {
  pipeline: RetrievalPipelineName;
  runId: string;
  config: Record<string, unknown>;
  datasetSize: number;
  meanJudgeScore: number | null;
  meanRecallAt5: number | null;
  meanRecallAt8: number | null;
  meanMrr: number | null;
  meanNdcgAt10: number | null;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number;
};

export type PerQueryReport = {
  pipeline: RetrievalPipelineName;
  runId: string;
  queryId: string;
  query: string;
  idealAnswer: string | null;
  generatedAnswer: string;
  judgeScore: number | null;
  judgeReasoning: string | null;
  latencyMs: number;
  costUsd: number;
};

export type EvalReportInput = {
  startedAt: Date;
  completedAt: Date;
  summaries: PipelineSummary[];
  queries: PerQueryReport[];
};

export function writeMarkdownReport(input: EvalReportInput): string {
  const timestamp = input.completedAt.toISOString().replace(/[:.]/g, '-');
  const outputPath = join('eval', 'reports', `${timestamp}.md`);
  const markdown = renderReport(input);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown, 'utf8');

  return outputPath;
}

function renderReport(input: EvalReportInput): string {
  const disagreement = findDisagreements(input.queries);
  const worst = [...input.queries]
    .sort((a, b) => (a.judgeScore ?? 0) - (b.judgeScore ?? 0))
    .slice(0, 10);

  return `# Methodology RAG Eval

${renderNarrative(input.summaries)}

LLM answer and judge calls use temperature 0 and a fixed seed where supported. Scores may still vary slightly because hosted LLMs are not perfectly deterministic.

## Run Metadata

- Started: ${input.startedAt.toISOString()}
- Completed: ${input.completedAt.toISOString()}
- Dataset size: ${input.summaries[0]?.datasetSize ?? 0}
- Runs: ${input.summaries.map((summary) => `${summary.pipeline}=${summary.runId}`).join(', ')}

## Pipeline Configs

\`\`\`json
${JSON.stringify(Object.fromEntries(input.summaries.map((summary) => [summary.pipeline, summary.config])), null, 2)}
\`\`\`

## Headline

| pipeline | mean judge_score | recall@5 | recall@8 | MRR | nDCG@10 | p50 latency | p95 latency | total cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${input.summaries.map(renderSummaryRow).join('\n')}

## Worst 10 By Judge Score

| pipeline | query | judge | latency | generated answer | ideal answer |
| --- | --- | ---: | ---: | --- | --- |
${worst.map(renderWorstRow).join('\n')}

## Top 5 Pipeline Disagreements

| query | hybrid judge | page_index judge | delta |
| --- | ---: | ---: | ---: |
${disagreement.map(renderDisagreementRow).join('\n')}
`;
}

function renderNarrative(summaries: PipelineSummary[]): string {
  if (summaries.length === 0) {
    return 'No pipeline summaries were produced.';
  }

  const byScore = maxBy(summaries, (summary) => summary.meanJudgeScore ?? Number.NEGATIVE_INFINITY);
  const byLatency = minBy(summaries, (summary) => summary.p50LatencyMs);
  const byCost = minBy(summaries, (summary) => summary.totalCostUsd);

  return `Summary: ${byScore.pipeline} led on judge score, ${byLatency.pipeline} led on p50 latency, and ${byCost.pipeline} led on total estimated cost. Review the disagreement table before choosing a default pipeline.`;
}

function renderSummaryRow(summary: PipelineSummary): string {
  return `| ${summary.pipeline} | ${fmt(summary.meanJudgeScore)} | ${fmt(summary.meanRecallAt5)} | ${fmt(summary.meanRecallAt8)} | ${fmt(summary.meanMrr)} | ${fmt(summary.meanNdcgAt10)} | ${summary.p50LatencyMs}ms | ${summary.p95LatencyMs}ms | $${summary.totalCostUsd.toFixed(6)} |`;
}

function renderWorstRow(row: PerQueryReport): string {
  return `| ${row.pipeline} | ${escapeCell(row.query)} | ${fmt(row.judgeScore)} | ${row.latencyMs}ms | ${escapeCell(truncate(row.generatedAnswer, 180))} | ${escapeCell(truncate(row.idealAnswer ?? '', 180))} |`;
}

function renderDisagreementRow(row: { query: string; hybrid: number | null; pageIndex: number | null; delta: number }): string {
  return `| ${escapeCell(row.query)} | ${fmt(row.hybrid)} | ${fmt(row.pageIndex)} | ${row.delta.toFixed(2)} |`;
}

function findDisagreements(rows: PerQueryReport[]) {
  const grouped = new Map<string, { query: string; hybrid: number | null; pageIndex: number | null }>();

  for (const row of rows) {
    const entry = grouped.get(row.query) ?? {
      query: row.query,
      hybrid: null,
      pageIndex: null,
    };

    if (row.pipeline === 'hybrid') {
      entry.hybrid = row.judgeScore;
    } else {
      entry.pageIndex = row.judgeScore;
    }

    grouped.set(row.query, entry);
  }

  return [...grouped.values()]
    .filter((entry) => entry.hybrid !== null && entry.pageIndex !== null)
    .map((entry) => ({
      ...entry,
      delta: Math.abs((entry.hybrid ?? 0) - (entry.pageIndex ?? 0)),
    }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);
}

function fmt(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(3);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function maxBy<T>(items: T[], select: (item: T) => number): T {
  return items.reduce((best, item) => (select(item) > select(best) ? item : best), items[0]!);
}

function minBy<T>(items: T[], select: (item: T) => number): T {
  return items.reduce((best, item) => (select(item) < select(best) ? item : best), items[0]!);
}
