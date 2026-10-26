import type {
  BenchmarkModelResult,
  BenchmarkResults,
  BenchmarkScore,
  BenchmarkScores,
} from "./types.js";

function formatCost(cost: number | undefined): string {
  return cost === undefined ? "—" : `$${cost.toFixed(4)}`;
}

function formatTime(ms: number | undefined): string {
  return ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`;
}

function ratio(
  value: number | undefined,
  baseline: number | undefined,
): string {
  if (value === undefined || baseline === undefined || baseline <= 0)
    return "—";
  return `${(value / baseline).toFixed(2)}×`;
}

function callSummary(result: BenchmarkRunLike | null): string {
  if (result === null) return "—";
  const truncations = result.calls.filter(
    (call) => call.finishReason === "length",
  ).length;
  const repairs = result.calls.filter((call) => call.repair).length;
  return `${result.calls.length} calls${truncations ? `, ${truncations} truncated` : ""}${
    repairs ? `, ${repairs} repaired` : ""
  }`;
}

type BenchmarkRunLike = {
  calls: Array<{ finishReason: string | null; repair: boolean }>;
};

function runCost(run: { costUsd: number } | null): number | undefined {
  return run?.costUsd;
}

function runTime(run: { wallMs: number } | null): number | undefined {
  return run?.wallMs;
}

function planSummary(result: BenchmarkModelResult): string {
  const plan = result.full?.plan;
  if (!plan) {
    const failure = result.error ?? result.full?.error ?? result.refresh?.error;
    return failure ? `Failed: ${failure}` : "No plan";
  }
  const sessions = plan.week.sessions
    .map((session) => `${session.day.slice(0, 3)} ${session.title}`)
    .join("; ");
  return [
    `Season ${plan.season.startDate} → ${plan.season.endDate} (${plan.season.blocks.length} blocks)`,
    `Block: ${plan.block.name} (${plan.block.startDate} → ${plan.block.endDate})`,
    `Week: ${plan.week.startDate} — ${sessions}`,
    `Day: ${plan.today.date} — ${plan.today.title} (${plan.today.durationMinutes} min)`,
  ].join("\n  ");
}

function scoreFor(
  scores: BenchmarkScores | null,
  model: string,
): BenchmarkScore | null {
  return scores?.[model] ?? null;
}

/**
 * Renders the source-controlled benchmark report. Quality scores are optional:
 * they are a human judgment, while cost and timing come from the run itself.
 */
export function renderBenchmarkReport(
  results: BenchmarkResults,
  options: { scores?: BenchmarkScores | null } = {},
): string {
  const scores = options.scores ?? null;
  const benchmark = results.metadata.benchmarkModel;
  const benchmarkResult = results.models[benchmark];
  const lines: string[] = [
    "# LLM coach benchmark",
    "",
    `- **Run:** \`${results.metadata.runId}\``,
    `- **Run at:** ${results.metadata.runAt}`,
    `- **Benchmark:** \`${benchmark}\` (first model in the list)`,
    `- **Athlete:** user ${results.metadata.userId}`,
    `- **Full build:** ${results.metadata.today}`,
    `- **Week + day refresh:** ${results.metadata.refreshToday}`,
    `- **Plan output budget:** ${results.metadata.planMaxTokens.toLocaleString()} tokens per attempt`,
  ];
  if (results.metadata.gitCommit !== null) {
    lines.push(`- **Git commit:** \`${results.metadata.gitCommit}\``);
  }
  lines.push(
    "",
    "Cost is the OpenRouter-reported cost, including retries and JSON repairs. Time is wall-clock for the whole chain. Quality is a manual assessment; it is not produced by the script.",
    "",
    "| Model | Quality | Full plan | Refresh | Total | Calls | Cost vs benchmark | Time vs benchmark |",
    "|---|---:|---|---|---|---:|---:|---:|",
  );

  for (const model of results.metadata.models) {
    const result = results.models[model];
    if (!result) continue;
    const score = scoreFor(scores, model);
    const totalCost =
      (runCost(result.full) ?? 0) + (runCost(result.refresh) ?? 0);
    const totalTime =
      (runTime(result.full) ?? 0) + (runTime(result.refresh) ?? 0);
    const benchmarkCost = benchmarkResult
      ? (runCost(benchmarkResult.full) ?? 0) +
        (runCost(benchmarkResult.refresh) ?? 0)
      : undefined;
    const benchmarkTime = benchmarkResult
      ? (runTime(benchmarkResult.full) ?? 0) +
        (runTime(benchmarkResult.refresh) ?? 0)
      : undefined;
    const quality = score ? `${score.quality.toFixed(1)}/10` : "—";
    const full =
      result.full === null
        ? "—"
        : result.full.ok
          ? `${formatTime(result.full.wallMs)} / ${formatCost(result.full.costUsd)}`
          : `failed (${formatTime(result.full.wallMs)} / ${formatCost(result.full.costUsd)})`;
    const refresh =
      result.refresh === null
        ? "—"
        : result.refresh.ok
          ? `${formatTime(result.refresh.wallMs)} / ${formatCost(result.refresh.costUsd)}`
          : `failed (${formatTime(result.refresh.wallMs)} / ${formatCost(result.refresh.costUsd)})`;
    lines.push(
      `| \`${model}\`${model === benchmark ? " **benchmark**" : ""} | ${quality} | ${full} | ${refresh} | ${formatTime(totalTime)} / ${formatCost(totalCost)} | ${callSummary(result.full)} / ${callSummary(result.refresh)} | ${ratio(totalCost, benchmarkCost)} | ${ratio(totalTime, benchmarkTime)} |`,
    );
  }

  if (scores !== null && Object.keys(scores).length > 0) {
    lines.push(
      "",
      "## Quality scores",
      "",
      "The benchmark is the reference point. Scores are relative judgments from reading the season, block, week and day levels.",
      "",
    );
    for (const model of results.metadata.models) {
      const score = scores[model];
      if (!score) continue;
      lines.push(
        `- **${score.quality.toFixed(1)}/10 — \`${model}\`:** ${score.notes}`,
      );
    }
  }

  lines.push("", "## Plans", "");
  for (const model of results.metadata.models) {
    const result = results.models[model];
    if (!result) continue;
    lines.push(
      `### \`${model}\``,
      "",
      "**Full build:**",
      "",
      `  ${planSummary(result)}`,
      "",
    );
    const refreshed = result.refresh?.plan;
    if (refreshed) {
      lines.push(
        "**Week + day refresh:**",
        "",
        `  Week ${refreshed.week.startDate}: ${refreshed.week.sessions
          .map((session) => `${session.day.slice(0, 3)} ${session.title}`)
          .join("; ")}`,
        `  Day ${refreshed.today.date}: ${refreshed.today.title} (${refreshed.today.durationMinutes} min)`,
        "",
      );
    }
    if (result.full?.error || result.refresh?.error) {
      lines.push(
        `**Error:** ${result.full?.error ?? result.refresh?.error}`,
        "",
      );
    }
    lines.push(
      `Raw plan: [\`plans/${model.replace(/[^a-zA-Z0-9.-]+/g, "_")}.json\`](plans/${model.replace(/[^a-zA-Z0-9.-]+/g, "_")}.json)`,
      "",
    );
  }

  lines.push(
    "## Notes",
    "",
    ...results.metadata.exclusions.map((note) => `- ${note}`),
    "",
  );
  return lines.join("\n");
}
