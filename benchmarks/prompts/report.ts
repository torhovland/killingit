import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const RUN_ID = process.env.RUN_ID ?? "2026-10-31-two-prompts";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);
const OUTPUT_HTML = resolve(import.meta.dir, "reports", `${RUN_ID}.html`);

interface Attempt {
  startedAt: string;
  timeMs: number;
  httpStatus: number | null;
  finishReason: string | null;
  costUsd: number;
  raw: string;
  parsed: unknown | null;
  parseError: string | null;
  error: string | null;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
}

interface PromptResult {
  prompt: string;
  attempts: Attempt[];
  retryNeeded: boolean;
  ok: boolean;
  totalTimeMs: number;
  totalCostUsd: number;
  plan: unknown | null;
  validationErrors: string[];
}

interface ModelResult {
  id: string;
  name: string;
  requestedAt: string;
  prompts: Record<string, PromptResult>;
  ok: boolean;
  totalTimeMs: number;
  totalCostUsd: number;
}

interface PromptJudge {
  score: number;
  components: Record<string, number>;
  note: string;
  judge: {
    model: string;
    attempts: number;
    timeMs: number;
    costUsd: number;
    error: string | null;
  };
}

interface JudgeScore {
  id: string;
  score: number;
  components: Record<string, number>;
  note: string;
  failed: boolean;
  gates: {
    atlasMentioned: boolean;
    blockOneChanged: boolean;
    blockOneStartDateKept: boolean;
    failures: string[];
  } | null;
  prompts: Record<string, PromptJudge>;
  judge?: {
    model: string;
    attempts: number;
    timeMs: number;
    costUsd: number;
    error: string | null;
  };
}

interface Override {
  score?: number;
  note?: string;
}

const PROMPTS = [
  { id: "today", label: "Today plan", file: "today-prompt.txt" },
  {
    id: "reviseSeason",
    label: "Season revision",
    file: "revise-season-prompt.txt",
  },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(5)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function scoreClass(score: number): string {
  if (score >= 11.5) return "score-excellent";
  if (score >= 10.5) return "score-strong";
  if (score >= 8.5) return "score-ok";
  if (score > 0) return "score-weak";
  return "score-fail";
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function promptPlanText(prompt: PromptResult | undefined): string {
  if (prompt === undefined) return "This prompt is missing from the run.";
  if (prompt.plan !== null) return prettyJson(prompt.plan);
  return prompt.attempts
    .map((attempt, attemptIndex) => {
      const reason =
        attempt.error ??
        attempt.parseError ??
        (attempt.raw ? "response did not match the contract" : "no content");
      return `attempt ${attemptIndex + 1}: ${reason}`;
    })
    .join("\n");
}

function gateLine(label: string, passed: boolean): string {
  return `<div class="gate ${passed ? "gate-pass" : "gate-fail"}"><span>${escapeHtml(label)}</span><strong>${passed ? "pass" : "FAIL"}</strong></div>`;
}

async function main(): Promise<void> {
  const results = JSON.parse(
    await readFile(resolve(RUN_DIR, "results.json"), "utf8"),
  ) as ModelResult[];
  const scoresFile = process.env.SCORES_FILE ?? "judge-scores.json";
  const scores = JSON.parse(
    await readFile(resolve(RUN_DIR, scoresFile), "utf8"),
  ) as JudgeScore[];
  let overrides: Record<string, Override> = {};
  if (process.env.USE_OVERRIDES !== "0") {
    try {
      overrides = JSON.parse(
        await readFile(resolve(RUN_DIR, "overrides.json"), "utf8"),
      ) as Record<string, Override>;
    } catch {
      overrides = {};
    }
  }

  const resultById = new Map(results.map((result) => [result.id, result]));
  for (const score of scores) {
    const override = overrides[score.id];
    if (override?.score !== undefined) score.score = override.score;
    if (override?.note !== undefined) score.note = override.note;
  }

  const ranked = [...scores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ra = resultById.get(a.id);
    const rb = resultById.get(b.id);
    return (ra?.totalCostUsd ?? 0) - (rb?.totalCostUsd ?? 0);
  });
  const best = ranked[0]?.score ?? 0;
  const close = ranked.filter((score) => score.score >= best - 0.3);
  const cheapest = [...close]
    .sort((a, b) => {
      const ra = resultById.get(a.id)?.totalCostUsd ?? 0;
      const rb = resultById.get(b.id)?.totalCostUsd ?? 0;
      return ra - rb;
    })
    .slice(0, 10);
  const fastest = [...close]
    .sort((a, b) => {
      const ra = resultById.get(a.id)?.totalTimeMs ?? 0;
      const rb = resultById.get(b.id)?.totalTimeMs ?? 0;
      return ra - rb;
    })
    .slice(0, 10);

  const totalCost = results.reduce(
    (sum, result) => sum + result.totalCostUsd,
    0,
  );
  const totalTime = results.reduce(
    (sum, result) => sum + result.totalTimeMs,
    0,
  );
  const valid = results.filter((result) => result.ok).length;
  const retries = results.filter(
    (result) =>
      result.prompts.today?.retryNeeded === true ||
      result.prompts.reviseSeason?.retryNeeded === true,
  ).length;
  const gateFailures = scores.filter(
    (score) => (score.gates?.failures.length ?? 0) > 0,
  ).length;
  const validScores = scores.filter(
    (score) => resultById.get(score.id)?.ok === true,
  );
  const avgScore =
    validScores.reduce((sum, score) => sum + score.score, 0) /
    Math.max(validScores.length, 1);
  const judgeModel =
    scores.find((score) => score.judge !== undefined)?.judge?.model ?? null;
  const judgeCost = scores.reduce(
    (sum, score) => sum + (score.judge?.costUsd ?? 0),
    0,
  );

  const rows = ranked
    .map((score, index) => {
      const result = resultById.get(score.id);
      if (!result) return "";
      return `<tr>
        <td class="num">${index + 1}</td>
        <td class="model">${escapeHtml(score.id)}</td>
        <td class="num score ${scoreClass(score.score)}">${score.score.toFixed(1)}</td>
        <td class="num">${formatTime(result.totalTimeMs)}</td>
        <td class="num">${formatCost(result.totalCostUsd)}</td>
        <td class="num">${result.prompts.today?.ok && result.prompts.reviseSeason?.ok ? "yes" : "no"}</td>
        <td class="num">${(score.gates?.failures.length ?? 0) === 0 ? "pass" : "FAIL"}</td>
      </tr>`;
    })
    .join("\n");

  const subsetRows = close
    .map((score, index) => {
      const result = resultById.get(score.id);
      if (!result) return "";
      return `<tr>
        <td class="num">${index + 1}</td>
        <td class="model">${escapeHtml(score.id)}</td>
        <td class="num score ${scoreClass(score.score)}">${score.score.toFixed(1)}</td>
        <td class="num">${formatTime(result.totalTimeMs)}</td>
        <td class="num">${formatCost(result.totalCostUsd)}</td>
        <td class="num">${(score.gates?.failures.length ?? 0) === 0 ? "pass" : "FAIL"}</td>
      </tr>`;
    })
    .join("\n");

  const cheapestRows = cheapest
    .map((score, index) => {
      const result = resultById.get(score.id);
      if (!result) return "";
      return `<tr>
        <td class="num">${index + 1}</td>
        <td class="model">${escapeHtml(score.id)}</td>
        <td class="num score ${scoreClass(score.score)}">${score.score.toFixed(1)}</td>
        <td class="num">${formatCost(result.totalCostUsd)}</td>
        <td class="num">${formatTime(result.totalTimeMs)}</td>
      </tr>`;
    })
    .join("\n");

  const fastestRows = fastest
    .map((score, index) => {
      const result = resultById.get(score.id);
      if (!result) return "";
      return `<tr>
        <td class="num">${index + 1}</td>
        <td class="model">${escapeHtml(score.id)}</td>
        <td class="num score ${scoreClass(score.score)}">${score.score.toFixed(1)}</td>
        <td class="num">${formatTime(result.totalTimeMs)}</td>
        <td class="num">${formatCost(result.totalCostUsd)}</td>
      </tr>`;
    })
    .join("\n");

  const sections = ranked
    .map((score, index) => {
      const result = resultById.get(score.id);
      if (!result) return "";
      const promptSections = PROMPTS.map((promptDefinition) => {
        const prompt = result.prompts[promptDefinition.id];
        const judged = score.prompts?.[promptDefinition.id];
        const lastAttempt = prompt?.attempts.at(-1);
        const retryText =
          prompt?.retryNeeded === true
            ? `yes (${prompt.attempts.length} attempts)`
            : "no";
        const componentText = judged
          ? `Contract ${judged.components.contract.toFixed(1)}/1.5 · Fidelity ${judged.components.fidelity.toFixed(1)}/2 · Design ${judged.components.design.toFixed(1)}/3 · Rationale ${judged.components.rationale.toFixed(1)}/2 · Grounding ${judged.components.grounding.toFixed(1)}/2 · Detail ${judged.components.detail.toFixed(1)}/2`
          : "no judged components";
        const errorText =
          prompt !== undefined && prompt.validationErrors.length > 0
            ? `<div class="errors"><strong>Validation:</strong> ${escapeHtml(prompt.validationErrors.join("; "))}</div>`
            : "";
        return `<div class="prompt-section">
          <div class="prompt-head">
            <h3>${escapeHtml(promptDefinition.label)}</h3>
            <div class="prompt-score ${scoreClass(judged?.score ?? 0)}">${(judged?.score ?? 0).toFixed(1)}<span>/12.5</span></div>
          </div>
          <div class="meta-grid prompt-meta">
            <div><span>Time</span><strong>${formatTime(prompt?.totalTimeMs ?? 0)}</strong></div>
            <div><span>Cost</span><strong>${formatCost(prompt?.totalCostUsd ?? 0)}</strong></div>
            <div><span>Retry</span><strong>${retryText}</strong></div>
            <div><span>Valid JSON</span><strong>${prompt?.ok ? "yes" : "no"}</strong></div>
            <div><span>HTTP</span><strong>${lastAttempt?.httpStatus ?? "—"}</strong></div>
            <div><span>Finish</span><strong>${escapeHtml(lastAttempt?.finishReason ?? "—")}</strong></div>
          </div>
          <div class="components">${componentText}</div>
          <div class="judgment"><strong>Judgment:</strong> ${escapeHtml(judged?.note ?? "Not judged.")}</div>
          ${errorText}
          <h3>Returned JSON</h3>
          <pre>${escapeHtml(promptPlanText(prompt))}</pre>
        </div>`;
      }).join("\n");

      const gateBlock = score.gates
        ? `<div class="gates">
            ${gateLine("Mentions Atlas", score.gates.atlasMentioned)}
            ${gateLine("Block 1 changed", score.gates.blockOneChanged)}
            ${gateLine("Block 1 starts 2026-10-26", score.gates.blockOneStartDateKept)}
          </div>
          ${
            score.gates.failures.length > 0
              ? `<div class="errors"><strong>Hard gates:</strong> ${escapeHtml(score.gates.failures.join("; "))}</div>`
              : ""
          }`
        : "";

      return `<section class="model-section">
        <div class="section-head">
          <div>
            <div class="rank">#${index + 1}</div>
            <h2>${escapeHtml(score.id)}</h2>
            <div class="provider">${escapeHtml(result.name)}</div>
          </div>
          <div class="score-box ${scoreClass(score.score)}">${score.score.toFixed(1)}<span>/12.5</span></div>
        </div>
        <div class="meta-grid">
          <div><span>Total time</span><strong>${formatTime(result.totalTimeMs)}</strong></div>
          <div><span>Total cost</span><strong>${formatCost(result.totalCostUsd)}</strong></div>
          <div><span>Both valid</span><strong>${result.ok ? "yes" : "no"}</strong></div>
          <div><span>Hard gates</span><strong>${(score.gates?.failures.length ?? 0) === 0 ? "pass" : "FAIL"}</strong></div>
          <div><span>Judge cost</span><strong>${formatCost(score.judge?.costUsd ?? 0)}</strong></div>
          <div><span>Judged</span><strong>${escapeHtml(score.judge?.model ?? "—")}</strong></div>
        </div>
        ${gateBlock}
        <div class="components">Combined components (weaker of the two prompts): Contract ${score.components.contract.toFixed(1)}/1.5 · Fidelity ${score.components.fidelity.toFixed(1)}/2 · Design ${score.components.design.toFixed(1)}/3 · Rationale ${score.components.rationale.toFixed(1)}/2 · Grounding ${score.components.grounding.toFixed(1)}/2 · Detail ${score.components.detail.toFixed(1)}/2</div>
        <div class="judgment"><strong>Combined judgment:</strong> ${escapeHtml(score.note)}</div>
        ${promptSections}
      </section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Prompt Benchmark — All OpenRouter Models</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #17202a;
    font-size: 10.5pt;
    line-height: 1.45;
    margin: 0;
  }
  h1 { font-size: 26pt; line-height: 1.15; margin: 0 0 6pt; letter-spacing: -0.5pt; }
  h2 { font-size: 14pt; margin: 0; letter-spacing: -0.2pt; }
  h3 { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.8pt; color: #576574; margin: 12pt 0 4pt; }
  p { margin: 0 0 8pt; }
  .cover { padding-top: 18mm; }
  .eyebrow { text-transform: uppercase; letter-spacing: 1.6pt; font-size: 8.5pt; color: #0b7285; font-weight: 700; }
  .subtitle { font-size: 13pt; color: #485460; margin: 0 0 24pt; max-width: 150mm; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; margin: 18pt 0 20pt; }
  .summary-card { border: 1px solid #d8dee6; border-radius: 8pt; padding: 10pt; background: #fbfcfd; }
  .summary-card span { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.7pt; color: #74808f; margin-bottom: 3pt; }
  .summary-card strong { font-size: 16pt; }
  .callout { border-left: 4pt solid #0b7285; background: #f1f8fa; padding: 10pt 12pt; margin: 14pt 0; border-radius: 0 6pt 6pt 0; }
  .callout strong { color: #0b7285; }
  .rules { margin: 10pt 0 0; padding-left: 16pt; }
  .rules li { margin-bottom: 4pt; }
  table { width: 100%; border-collapse: collapse; font-size: 8.2pt; }
  thead { display: table-header-group; }
  th { text-align: left; background: #17202a; color: #fff; padding: 5pt 4pt; font-size: 7.6pt; text-transform: uppercase; letter-spacing: 0.5pt; }
  td { padding: 3.5pt 4pt; border-bottom: 1px solid #e6eaef; vertical-align: top; }
  tr:nth-child(even) td { background: #fafbfc; }
  .num { text-align: right; white-space: nowrap; }
  .model { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 7.6pt; word-break: break-all; }
  .score { font-weight: 700; }
  .score-excellent { color: #0b6b3a; }
  .score-strong { color: #1b7a4b; }
  .score-ok { color: #8a6d00; }
  .score-weak { color: #b05a00; }
  .score-fail { color: #b00020; }
  .page-break { break-before: page; }
  .section-title { font-size: 18pt; margin: 0 0 4pt; }
  .section-intro { color: #576574; margin-bottom: 12pt; }
  .model-section {
    border: 1px solid #d8dee6;
    border-radius: 8pt;
    padding: 12pt 14pt;
    margin: 0 0 12pt;
    break-inside: avoid;
  }
  .section-head { display: flex; justify-content: space-between; gap: 12pt; align-items: flex-start; border-bottom: 1px solid #e6eaef; padding-bottom: 8pt; margin-bottom: 8pt; }
  .rank { font-size: 8pt; color: #8391a1; font-weight: 700; letter-spacing: 0.8pt; }
  .provider { font-size: 8.5pt; color: #74808f; margin-top: 2pt; }
  .score-box { font-size: 22pt; font-weight: 800; line-height: 1; white-space: nowrap; }
  .score-box span { font-size: 9pt; font-weight: 500; color: #8391a1; }
  .meta-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6pt; margin-bottom: 8pt; }
  .meta-grid span { display: block; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.5pt; color: #8391a1; }
  .meta-grid strong { font-size: 9pt; }
  .prompt-section { border-top: 1px solid #e6eaef; margin-top: 10pt; padding-top: 2pt; }
  .prompt-head { display: flex; justify-content: space-between; align-items: baseline; }
  .prompt-head h3 { margin-top: 8pt; }
  .prompt-score { font-size: 14pt; font-weight: 800; }
  .prompt-score span { font-size: 8pt; font-weight: 500; color: #8391a1; }
  .prompt-meta { margin-top: 4pt; }
  .components { font-size: 7.8pt; color: #576574; background: #f4f6f8; border-radius: 4pt; padding: 4pt 6pt; margin-bottom: 7pt; }
  .judgment { font-size: 9.2pt; margin-bottom: 6pt; }
  pre {
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 7.2pt;
    line-height: 1.35;
    background: #f6f8fa;
    border: 1px solid #e1e6eb;
    border-radius: 5pt;
    padding: 8pt;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }
  .errors { font-size: 8pt; color: #b00020; margin-top: 6pt; }
  .gates { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6pt; margin: 4pt 0 8pt; }
  .gate { border-radius: 4pt; padding: 4pt 6pt; font-size: 8pt; display: flex; justify-content: space-between; gap: 6pt; }
  .gate-pass { background: #e9f7ee; color: #0b6b3a; }
  .gate-fail { background: #fdecef; color: #b00020; }
  .note { font-size: 8.5pt; color: #576574; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18pt; }
  .toc-note { font-size: 9pt; color: #576574; margin-top: 10pt; }
  .keep { break-inside: avoid; }
</style>
</head>
<body>
<div class="cover">
  <div class="eyebrow">Killingit · LLM benchmark</div>
  <h1>Prompt Benchmark</h1>
  <p class="subtitle">Two coaching tasks, all ${results.length} selected models on OpenRouter. Same athlete, two prompts: a single day on Friday 30 October 2026, and a drastic season revision on Saturday 31 October 2026 after the Atlas Mountain Race entered the calendar. Every valid response is scored by ${judgeModel ?? "the judge model"}.</p>

  <div class="summary-grid">
    <div class="summary-card"><span>Models</span><strong>${results.length}</strong></div>
    <div class="summary-card"><span>Valid on both</span><strong>${valid}</strong></div>
    <div class="summary-card"><span>Hard-gate failures</span><strong>${gateFailures}</strong></div>
    <div class="summary-card"><span>Average score (valid)</span><strong>${avgScore.toFixed(1)}</strong></div>
  </div>

  <div class="callout">
    <strong>What was tested.</strong> Each model received
    <code>benchmarks/prompts/today-prompt.txt</code> and
    <code>benchmarks/prompts/revise-season-prompt.txt</code> verbatim, in two
    separate calls. The today prompt asks for only the plan for 2026-10-30. The
    revision prompt asks for a refreshed season, current block, week and day
    after the athlete added the Atlas Mountain Race on 25 December 2026. Both
    prompts contain the full athlete profile, recent activities and coach
    analyses, the current plan, the athlete's latest metrics, and the weather
    forecast. A model needed a retry when a response was not parseable or did
    not match its contract. ${retries} models needed at least one retry.
    ${results.length - valid} models did not return valid JSON on both prompts;
    they remain in the tables with a score of 0 and their provider error.
  </div>

  <div class="callout">
    <strong>Hard gates on the season revision.</strong> Ability is F for any
    model that does not mention Atlas anywhere in its output, leaves block 1
    unchanged, or changes the start date of block 1 (2026-10-26). The gates are
    checked mechanically against the supplied current block, not by the judge.
    ${gateFailures} models failed at least one gate.
  </div>

  <div class="callout">
    <strong>How quality was judged.</strong> Every valid JSON response was read
    and scored by ${judgeModel ?? "the judge model"} (OpenRouter) with a rubric
    for its prompt, not by a code pattern matcher. Each prompt is scored out of
    12.5 across contract compliance (1.5), fidelity (2.0), design (3.0),
    rationale (2.0), grounding (2.0), and extra, useful detail (2.0). The
    combined score is the mean of the two prompt scores; each component keeps
    the weaker of the two values, so a failing component in either prompt grades
    the model F. Time and cost are the sum of both prompt runs, including
    retries. Judge cost: ${judgeModel ? formatCost(judgeCost) : "—"}.
  </div>

  <div class="summary-grid">
    <div class="summary-card"><span>Summed model time</span><strong>${(totalTime / 60000).toFixed(1)} min</strong></div>
    <div class="summary-card"><span>Total cost</span><strong>${formatCost(totalCost)}</strong></div>
    <div class="summary-card"><span>Best score</span><strong>${best.toFixed(1)}</strong></div>
    <div class="summary-card"><span>Within 0.3 of best</span><strong>${close.length}</strong></div>
  </div>

  <p class="toc-note">Run <code>${RUN_ID}</code> · generated ${new Date().toISOString().slice(0, 10)} · model costs are OpenRouter-reported, including retries · times are the sum of both prompts · judge: ${judgeModel ?? "—"}.</p>
</div>

<div class="page-break"></div>
<h1 class="section-title">All models</h1>
<p class="section-intro">Ranked by combined judged quality, then by cost. Time and cost include both prompts and any retry.</p>
<table>
  <thead><tr><th class="num">Rank</th><th>Model</th><th class="num">Score /12.5</th><th class="num">Time</th><th class="num">Cost</th><th class="num">Both valid</th><th class="num">Gates</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class="page-break"></div>
<h1 class="section-title">Models close to the best</h1>
<p class="section-intro">Every model scoring within 0.3 points of the best (${best.toFixed(1)}), ranked by quality and then cost. This is the practical shortlist: the plans that are close to as good as the best one on both prompts.</p>
<table>
  <thead><tr><th class="num">Rank</th><th>Model</th><th class="num">Score /12.5</th><th class="num">Time</th><th class="num">Cost</th><th class="num">Gates</th></tr></thead>
  <tbody>${subsetRows}</tbody>
</table>

<div class="page-break"></div>
<h1 class="section-title">Best value in the shortlist</h1>
<div class="keep">
  <h3>Top 10 cheapest</h3>
  <table>
    <thead><tr><th class="num">#</th><th>Model</th><th class="num">Score /12.5</th><th class="num">Cost</th><th class="num">Time</th></tr></thead>
    <tbody>${cheapestRows}</tbody>
  </table>
</div>
<div class="page-break"></div>
<div class="keep">
  <h3>Top 10 fastest</h3>
  <table>
    <thead><tr><th class="num">#</th><th>Model</th><th class="num">Score /12.5</th><th class="num">Time</th><th class="num">Cost</th></tr></thead>
    <tbody>${fastestRows}</tbody>
  </table>
</div>
<p class="section-intro" style="margin-top:14pt">Both lists are restricted to the shortlist above. A zero cost is an OpenRouter free or zero-priced model.</p>

<div class="page-break"></div>
<h1 class="section-title">Model-by-model</h1>
<p class="section-intro">One section per model in rank order. Each shows the sum of both prompts, the hard gates, and then each prompt's score, judgment and JSON exactly as returned (pretty-printed).</p>

${sections}
</body>
</html>`;

  await writeFile(OUTPUT_HTML, html);
  console.log(`wrote ${OUTPUT_HTML}`);
  console.log(`best ${best.toFixed(1)}, shortlist ${close.length}`);
}

await main();
