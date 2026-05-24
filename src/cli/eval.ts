import { runEval } from '../eval/runner.js';
import type { RetrievalPipelineName } from '../rag/types.js';

const pipelines = parsePipelines(process.argv.slice(2));

try {
  const result = await runEval({ pipelines });
  console.log(
    JSON.stringify(
      {
        report_path: result.reportPath,
        summaries: result.summaries,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function parsePipelines(args: string[]): RetrievalPipelineName[] {
  const pipelineArg = args.find((arg) => arg.startsWith('--pipelines='));

  if (!pipelineArg) {
    return ['hybrid', 'page_index'];
  }

  const pipelines = pipelineArg
    .slice('--pipelines='.length)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (pipelines.every((pipeline): pipeline is RetrievalPipelineName => pipeline === 'hybrid' || pipeline === 'page_index')) {
    return pipelines;
  }

  throw new Error('--pipelines must be a comma-separated list containing only hybrid,page_index');
}
