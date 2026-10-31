import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const RUN_ID = process.env.RUN_ID ?? "2026-10-30-all-models";
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

interface ModelResult {
  id: string;
  name: string;
  requestedAt: string;
  attempts: Attempt[];
  retryNeeded: boolean;
  ok: boolean;
  totalTimeMs: number;
  totalCostUsd: number;
  plan: { today?: Record<string, unknown> } | null;
  validationErrors: string[];
}

interface Score {
  id: string;
  score: number;
  components: {
    contract: number;
    fidelity: number;
    design: number;
    rationale: number;
    grounding: number;
    detail: number;
  };
  flags?: string[];
  note: string;
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

async function main(): Promise<void> {
  const results = JSON.parse(
    await readFile(resolve(RUN_DIR, "results.json"), "utf8"),
  ) as ModelResult[];
  const scoresFile = process.env.SCORES_FILE ?? "scores.json";
  const scores = JSON.parse(
    await readFile(resolve(RUN_DIR, scoresFile), "utf8"),
  ) as Score[];
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
  const retries = results.filter((result) => result.retryNeeded).length;
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
        <td class="num">${result.retryNeeded ? "yes" : "no"}</td>
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
        <td class="num">${result.retryNeeded ? "yes" : "no"}</td>
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
      const lastAttempt = result.attempts.at(-1);
      const plan = result.plan;
      const jsonText = plan
        ? prettyJson(plan)
        : result.attempts
            .map((attempt, attemptIndex) => {
              const reason =
                attempt.error ??
                attempt.parseError ??
                (attempt.raw
                  ? "response did not match the contract"
                  : "no content");
              return `attempt ${attemptIndex + 1}: ${reason}`;
            })
            .join("\n");
      const retryText = result.retryNeeded
        ? `yes (${result.attempts.length} attempts)`
        : "no";
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
          <div><span>Time</span><strong>${formatTime(result.totalTimeMs)}</strong></div>
          <div><span>Cost</span><strong>${formatCost(result.totalCostUsd)}</strong></div>
          <div><span>Retry</span><strong>${retryText}</strong></div>
          <div><span>Valid JSON</span><strong>${result.ok ? "yes" : "no"}</strong></div>
          <div><span>HTTP</span><strong>${lastAttempt?.httpStatus ?? "—"}</strong></div>
          <div><span>Finish</span><strong>${escapeHtml(lastAttempt?.finishReason ?? "—")}</strong></div>
        </div>
        <div class="components">
          Contract ${score.components.contract.toFixed(1)}/1.5 ·
          Fidelity ${score.components.fidelity.toFixed(1)}/2 ·
          Design ${score.components.design.toFixed(1)}/3 ·
          Rationale ${score.components.rationale.toFixed(1)}/2 ·
          Grounding ${score.components.grounding.toFixed(1)}/2 ·
          Detail ${score.components.detail.toFixed(1)}/2
        </div>
        <div class="judgment"><strong>Judgment:</strong> ${escapeHtml(score.note)}</div>
        <h3>Returned JSON</h3>
        <pre>${escapeHtml(jsonText)}</pre>
        ${
          result.validationErrors.length > 0
            ? `<div class="errors"><strong>Validation:</strong> ${escapeHtml(result.validationErrors.join("; "))}</div>`
            : ""
        }
        ${
          result.attempts.length > 1
            ? `<div class="errors"><strong>Attempts:</strong> ${result.attempts
                .map(
                  (attempt, attemptIndex) =>
                    `#${attemptIndex + 1} ${formatTime(attempt.timeMs)} ${formatCost(attempt.costUsd)}${attempt.error ? ` — ${escapeHtml(attempt.error)}` : attempt.parseError ? ` — ${escapeHtml(attempt.parseError)}` : ""}`,
                )
                .join(" · ")}</div>`
            : ""
        }
      </section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Today Prompt Benchmark — All OpenRouter Models</title>
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
  .note { font-size: 8.5pt; color: #576574; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18pt; }
  .toc-note { font-size: 9pt; color: #576574; margin-top: 10pt; }
  .keep { break-inside: avoid; }
</style>
</head>
<body>
<div class="cover">
  <div class="eyebrow">Killingit · LLM benchmark</div>
  <h1>Today Prompt Benchmark</h1>
  <p class="subtitle">One coaching decision, all ${results.length} base models on OpenRouter. Same prompt, same athlete, same day: Friday 30 October 2026. Every valid response is scored by ${judgeModel ?? "the judge model"} with a dedicated extra-useful-detail category.</p>

  <div class="summary-grid">
    <div class="summary-card"><span>Models</span><strong>${results.length}</strong></div>
    <div class="summary-card"><span>Valid JSON</span><strong>${valid}</strong></div>
    <div class="summary-card"><span>Needed retry</span><strong>${retries}</strong></div>
    <div class="summary-card"><span>Average score (valid)</span><strong>${avgScore.toFixed(1)}</strong></div>
  </div>

  <div class="callout">
    <strong>What was tested.</strong> Each model received the prompt in
    <code>benchmarks/today-prompt/prompt.txt</code> verbatim and was asked for
    only the plan for today, 2026-10-30, as JSON. The prompt contains the full
    athlete profile, recent activities and coach analyses, the current season,
    block and week, the athlete's latest metrics, and the weather forecast.
    The stored Friday session is a 45-minute moderate gym strength session
    (Gym Strength B) in the Autumn Re-Entry block. A model needed a retry when
    its first response was not parseable, did not match the contract, or the
    request failed. The field is every standard (non-variant) text model listed
    on OpenRouter; <code>:batch</code> and <code>:free</code> aliases are
    excluded. ${results.length - valid} models returned no valid JSON after both
    attempts; they remain in the tables with a score of 0 and their provider
    error.
  </div>

  <div class="callout">
    <strong>How quality was judged.</strong> Every valid JSON response was read
    and scored by ${judgeModel ?? "the judge model"} (OpenRouter), not by a code
    pattern matcher. The judge received only the original prompt and the
    candidate response; it inferred the athlete, constraints and expected
    session itself. The score is the sum of six components with a maximum of
    12.5: contract compliance (1.5), fidelity to the original prompt and current
    plan (2.0), session design (3.0), rationale (2.0), grounding (2.0), and
    <em>extra, useful detail</em> in the workout description (2.0). Design rewards
    a specific, safe, well-sequenced session without requiring any particular
    exercise. Detail rewards execution help such as load progression, technique
    cues, stop conditions, fallbacks, explicit assumptions and success criteria,
    not padding. Models that returned no valid JSON after one retry score 0 and
    were not sent to the judge. Judge cost: ${judgeModel ? formatCost(judgeCost) : "—"}.
  </div>

  <div class="summary-grid">
    <div class="summary-card"><span>Summed model time</span><strong>${(totalTime / 60000).toFixed(1)} min</strong></div>
    <div class="summary-card"><span>Total cost</span><strong>${formatCost(totalCost)}</strong></div>
    <div class="summary-card"><span>Best score</span><strong>${best.toFixed(1)}</strong></div>
    <div class="summary-card"><span>Within 0.3 of best</span><strong>${close.length}</strong></div>
  </div>

  <p class="toc-note">Run <code>${RUN_ID}</code> · generated ${new Date().toISOString().slice(0, 10)} · model costs are OpenRouter-reported, including retries · times are wall-clock · judge: ${judgeModel ?? "—"}.</p>
</div>

<div class="page-break"></div>
<h1 class="section-title">All models</h1>
<p class="section-intro">Ranked by judged quality, then by cost. Time and cost include any retry.</p>
<table>
  <thead><tr><th class="num">Rank</th><th>Model</th><th class="num">Score /12.5</th><th class="num">Time</th><th class="num">Cost</th><th class="num">Retry</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class="page-break"></div>
<h1 class="section-title">Models close to the best</h1>
<p class="section-intro">Every model scoring within 0.3 points of the best (${best.toFixed(1)}), ranked by quality and then cost. This is the practical shortlist: the plans that are close to as good as the best one.</p>
<table>
  <thead><tr><th class="num">Rank</th><th>Model</th><th class="num">Score /12.5</th><th class="num">Time</th><th class="num">Cost</th><th class="num">Retry</th></tr></thead>
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
<p class="section-intro">One section per model in rank order. Each shows the measured time and cost, whether a retry was needed, the judged score and its components, a short judgment, and the JSON exactly as returned (pretty-printed).</p>

${sections}
</body>
</html>`;

  await writeFile(OUTPUT_HTML, html);
  console.log(`wrote ${OUTPUT_HTML}`);
  console.log(`best ${best.toFixed(1)}, shortlist ${close.length}`);
}

await main();
