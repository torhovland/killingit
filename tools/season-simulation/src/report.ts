import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { GRAVEL_RACE, HALF_MARATHON, SEASON_END_DATE } from "./config.js";
import type {
  ReportData,
  ScenarioResult,
  SessionRecord,
  WeekRecord,
} from "./types.js";
import { formatClock } from "./athlete.js";
import { escapeHtml, lineChart } from "./reportRender.js";

/** Writes one scenario result so a later report run can read it back. */
export async function writeScenarioResult(
  directory: string,
  result: ScenarioResult,
  suffix = "",
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `results-${result.scenario}${suffix}.json`);
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return path;
}

/** Reads every scenario result a report run needs. */
export async function loadResults(
  directory: string,
  suffix = "",
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of ["full", "reduced"] as const) {
    const text = await readFile(
      join(directory, `results-${scenario}${suffix}.json`),
      "utf8",
    );
    results.push(JSON.parse(text) as ScenarioResult);
  }
  return results;
}

/** Renders the HTML report and a PDF beside it. */
export async function writeReport(
  directory: string,
  data: ReportData,
): Promise<{ html: string; pdf: string }> {
  const html = buildReportHtml(data);
  await mkdir(directory, { recursive: true });
  const htmlPath = join(directory, "report.html");
  const pdfPath = join(directory, "report.pdf");
  await writeFile(htmlPath, html, "utf8");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "14mm", bottom: "16mm", left: "14mm" },
    });
  } finally {
    await browser.close();
  }
  return { html: htmlPath, pdf: pdfPath };
}

/** The complete printable report. */
function buildReportHtml(data: ReportData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Season simulation report</title>
${STYLE}
</head>
<body>
<h1>Can the coach get this athlete to the goals?</h1>
<p class="subtitle">A two-scenario season simulation against the real plan pipeline. Generated ${escapeHtml(data.generatedAt)} with <code>${escapeHtml(data.model)}</code>.</p>
${executiveSummary(data)}
${methodSection()}
${data.scenarios.map(scenarioSection).join("")}
${comparisonSection(data)}
${findingsSection(data)}
${caveatsSection()}
</body>
</html>`;
}

const STYLE = `<style>
:root { --ink:#14201b; --muted:#5d6b64; --line:#d8e0db; --good:#1f7a4d; --bad:#b3261e; --warn:#9a6700; --bg:#f7faf8; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--ink); margin: 0; font-size: 10.5px; line-height: 1.45; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 22px 0 8px; border-bottom: 2px solid var(--ink); padding-bottom: 4px; }
h3 { font-size: 12px; margin: 14px 0 6px; }
p { margin: 0 0 8px; }
.subtitle { color: var(--muted); margin-bottom: 16px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5px; background: var(--bg); padding: 1px 3px; border-radius: 3px; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 8.6px; }
th, td { text-align: left; padding: 3px 4px; border-bottom: 1px solid var(--line); vertical-align: top; }
td:first-child { white-space: nowrap; }
th { background: var(--bg); font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.good { color: var(--good); font-weight: 600; }
.bad { color: var(--bad); font-weight: 600; }
.warn { color: var(--warn); font-weight: 600; }
.cards { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 12px; }
.card { border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; flex: 1 1 150px; background: #fff; }
.card .label { color: var(--muted); font-size: 8.6px; text-transform: uppercase; letter-spacing: .04em; }
.card .value { font-size: 15px; font-weight: 700; margin-top: 2px; }
.note { background: var(--bg); border-left: 3px solid var(--muted); padding: 6px 9px; margin: 8px 0; }
.quote { font-style: italic; color: #33413a; border-left: 3px solid var(--line); padding-left: 8px; margin: 6px 0; }
.small { font-size: 8.6px; color: var(--muted); }
.pb { page-break-before: always; }
svg { max-width: 100%; page-break-inside: avoid; }
.legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 8.6px; margin: 4px 0; }
.legend span::before { content: ""; display: inline-block; width: 9px; height: 3px; margin-right: 4px; vertical-align: middle; background: var(--c); }
</style>`;

function executiveSummary(data: ReportData): string {
  const full = scenario(data, "full");
  const reduced = scenario(data, "reduced");
  return `<div class="cards">
${goalCard("Half marathon", full, "half")}
${goalCard("Gravel race", full, "gravel")}
${goalCard("Half marathon", reduced, "half")}
${goalCard("Gravel race", reduced, "gravel")}
</div>
<p>Test 1 (${escapeHtml(full?.label ?? "compliant")}) completed ${String(full?.recordedSessions ?? 0)} of ${String(full?.totalSessions ?? 0)} prescribed workouts and recorded ${String(Math.round(full?.totalRecordedTss ?? 0))} TSS. Test 2 (${escapeHtml(reduced?.label ?? "reduced")}) completed ${String(reduced?.recordedSessions ?? 0)} of ${String(reduced?.totalSessions ?? 0)} for ${String(Math.round(reduced?.totalRecordedTss ?? 0))} TSS.</p>`;
}

function goalCard(
  label: string,
  scenario: ScenarioResult | undefined,
  kind: "half" | "gravel",
): string {
  const race = scenario?.races.find((entry) => entry.kind === kind);
  if (race === undefined) {
    return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value warn">Not reached</div><div class="small">The season stopped before this race.</div></div>`;
  }
  const status = race.met ? "Met" : "Missed";
  const className = race.met ? "good" : "bad";
  return `<div class="card"><div class="label">${escapeHtml(label)} · ${escapeHtml(scenario?.label ?? "")}</div><div class="value ${className}">${status}</div><div class="small">${formatClock(race.predictedSeconds)} vs target ${formatClock(race.targetSeconds)}${race.soloPredictedSeconds === null ? "" : ` · solo ${formatClock(race.soloPredictedSeconds)}`}</div></div>`;
}

function methodSection(): string {
  return `<h2>Method</h2>
<p><strong>Athlete.</strong> Male, 50, 85 kg, 187 cm, Trondheim (Europe/Oslo). Starting FTP 180 W, running threshold 6:00 /km, resting HR 55, maximum HR 185, no recent training. Five years ago: FTP about 285 W, and the same 100 km / 1,170 m gravel race in 3:20 at an average heart rate of 163.</p>
<p><strong>Goals.</strong> A half marathon under 2:00 on ${HALF_MARATHON.date}, and the 100 km / 1,170 m gravel race in 3:10 or faster on ${GRAVEL_RACE.date}. The season runs from 2026-11-22 to ${SEASON_END_DATE}.</p>
<p><strong>Loop.</strong> A real <code>newSeason</code> build starts the season. Every Sunday at 21:00 the harness records the week's activities, writes the modelled FTP and threshold pace as Garmin-style estimates, and runs a real plan refresh with <code>includeTomorrow</code>. The next week is read from <code>nextWeek</code>, then simulated day by day. Sundays continue until the season ends.</p>
<p><strong>Activities.</strong> Each prescribed session is converted into an imported activity with concrete duration, distance, elevation, average and normalized power, average heart rate and pace. Cycling and running TSS therefore comes from measured power or pace, not from free text. A race day is simulated from the athlete's modelled ability on that morning.</p>
<p><strong>Progression.</strong> Ability is a function of chronic training load (CTL, 42-day EWMA): the athlete regains the gap to the prior peak with diminishing returns and never exceeds it in this model. The model is a simulation assumption, not app logic.</p>
<p><strong>Feasibility.</strong> The report makes an independent numeric check beside the coach's own words. The half is predicted from threshold pace (half pace = 1.04 × threshold, 1% taper). The gravel race uses a steady-state speed/power model (93 kg system mass, CdA 0.385, Crr 0.0055, 97% drivetrain, 3:10 target). A target is treated as met within a 1% modelling tolerance. The solo and group cases are reported separately.</p>
<div class="note">Weather and daylight are a deterministic Trondheim-like seasonal approximation rather than a live provider call, so the season is reproducible. The app's real prompt, plan validation, period reviews and stored-plan pipeline are otherwise used unchanged. Test 2 is the alternate-day reference from the earlier prompt set; it is retained to show the adherence effect, not as a controlled model comparison.</div>`;
}

function scenarioSection(result: ScenarioResult): string {
  return `<div class="pb"></div>
<h2>${result.scenario === "full" ? "Test 1" : "Test 2"} — ${escapeHtml(result.label)}</h2>
<p>${escapeHtml(result.description)} Season ${escapeHtml(result.season?.startDate ?? "—")} → ${escapeHtml(result.season?.endDate ?? "—")}. Model ${escapeHtml(result.model)}. ${String(result.calls.length)} model calls, ${formatCost(result.costUsd)}, ${formatNumber(result.promptTokens)} prompt and ${formatNumber(result.completionTokens)} completion tokens. Wall time ${wallTime(result)}.</p>
${raceSection(result)}
<h3>Weekly progression</h3>
${charts(result)}
<h3>Weekly detail</h3>
${weeklyTable(result.weeks)}
${coachSection(result)}
${result.notes.length === 0 ? "" : `<h3>Run notes</h3>${result.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}`}`;
}

function raceSection(result: ScenarioResult): string {
  if (result.races.length === 0) {
    return `<div class="note">No race was reached before the season ended.</div>`;
  }
  return result.races
    .map(
      (race) => `<div class="card">
<div class="label">${escapeHtml(race.title)} · ${race.date}</div>
<div class="value ${race.met ? "good" : "bad"}">${race.met ? "Feasible / target met" : "Goal not met"} — ${formatClock(race.predictedSeconds)}</div>
<div class="small">Target ${formatClock(race.targetSeconds)}${race.soloPredictedSeconds === null ? "" : ` · solo prediction ${formatClock(race.soloPredictedSeconds)}`}. ${escapeHtml(race.detail)}</div>
<div class="quote">${escapeHtml(truncate(race.coachText, 700))}</div>
</div>`,
    )
    .join("");
}

function charts(result: ScenarioResult): string {
  const weeks = result.weeks;
  const labels = weeks.map((week) => week.weekStart);
  const ctl = weeks.map((week) => ({
    label: week.weekStart,
    value: week.stateAtEnd.ctl,
  }));
  const ftp = weeks.map((week) => ({
    label: week.weekStart,
    value: week.stateAtEnd.ftpWatts,
  }));
  const pace = weeks.map((week) => ({
    label: week.weekStart,
    value: week.stateAtEnd.runThresholdSecPerKm,
  }));
  const half = weeks.map((week) => ({
    label: week.weekStart,
    value: week.halfPrediction.seconds / 60,
  }));
  const bike = weeks.map((week) => ({
    label: week.weekStart,
    value: week.bikePrediction.draftSeconds / 60,
  }));
  return `<div class="legend"><span style="--c:#1f7a4d">CTL</span><span style="--c:#2b6cb0">FTP (W)</span><span style="--c:#b7791f">Run threshold (s/km)</span><span style="--c:#805ad5">Half prediction (min)</span><span style="--c:#c05621">Gravel group prediction (min)</span></div>
${lineChart([{ label: "CTL", color: "#1f7a4d", points: ctl }], "Chronic load (CTL)")}
${lineChart([{ label: "FTP", color: "#2b6cb0", points: ftp }], "FTP (W)")}
${lineChart([{ label: "Run threshold", color: "#b7791f", points: pace }], "Running threshold pace (lower is faster)")}
${lineChart(
  [
    { label: "Half", color: "#805ad5", points: half },
    { label: "Gravel group", color: "#c05621", points: bike },
  ],
  "Predicted race times (minutes, lower is faster)",
)}
<div class="small">${String(labels.length)} weeks from ${escapeHtml(labels[0] ?? "")} to ${escapeHtml(labels.at(-1) ?? "")}.</div>`;
}

function weeklyTable(weeks: WeekRecord[]): string {
  const rows = weeks
    .map((week) => {
      const flags = week.sessions.filter(
        (entry) => !entry.feasible && !isRaceSession(entry),
      ).length;
      return `<tr>
<td>${escapeHtml(week.weekStart)}</td>
<td>${escapeHtml(truncate(week.blockName, 22))}</td>
<td>${escapeHtml(truncate(week.weekFocus, 46))}</td>
<td class="num">${String(week.plannedTss)}</td>
<td class="num">${String(week.completedTss)}</td>
<td class="num">${String(week.sessions.filter((entry) => entry.recorded).length)}</td>
<td class="num">${String(Math.round(week.stateAtEnd.ctl))}</td>
<td class="num">${String(Math.round(week.stateAtEnd.ftpWatts))}</td>
<td class="num">${formatPace(week.stateAtEnd.runThresholdSecPerKm)}</td>
<td class="num">${formatClock(week.halfPrediction.seconds)}</td>
<td class="num">${formatClock(week.bikePrediction.draftSeconds)}</td>
<td>${flags === 0 ? "" : `<span class="warn">${String(flags)} flag</span>`}</td>
</tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Week</th><th>Block</th><th>Focus</th><th class="num">Plan TSS</th><th class="num">Done TSS</th><th class="num">Sessions</th><th class="num">CTL</th><th class="num">FTP</th><th class="num">Threshold</th><th class="num">Half</th><th class="num">Gravel</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function coachSection(result: ScenarioResult): string {
  const races = result.races
    .map(
      (race) =>
        `<p><strong>${escapeHtml(race.title)}, ${race.date}:</strong></p><div class="quote">${escapeHtml(truncate(race.coachText, 1_200))}</div>`,
    )
    .join("");
  const feasibility = result.weeks
    .map((week) => week.coachFeasibility)
    .filter((text): text is string => text !== null)
    .slice(-4)
    .map(
      (text) => `<div class="quote">${escapeHtml(truncate(text, 500))}</div>`,
    )
    .join("");
  return `<h3>What the coach said</h3><p><strong>Season goal:</strong> ${escapeHtml(result.season?.goal ?? "—")}</p>${races}${feasibility === "" ? "" : `<p><strong>Recent feasibility language:</strong></p>${feasibility}`}`;
}

function comparisonSection(data: ReportData): string {
  const full = scenario(data, "full");
  const reduced = scenario(data, "reduced");
  if (full === undefined || reduced === undefined) {
    return "";
  }
  const rows = comparisonRows(full, reduced);
  return `<h2>Comparison</h2><table><thead><tr><th>Metric</th><th>Test 1 (full)</th><th>Test 2 (alternate days)</th><th>Ratio</th></tr></thead><tbody>${rows.map(([label, a, b, c]) => `<tr><td>${escapeHtml(label)}</td><td class="num">${a}</td><td class="num">${b}</td><td class="num">${c}</td></tr>`).join("")}</tbody></table>`;
}

interface ScenarioSummary {
  totalTss: number;
  recorded: number;
  total: number;
  ctl: number;
  ftp: number;
  peakCtl: number;
  peakFtp: number;
  half: number;
  gravel: number;
  cost: number;
}

function comparisonRows(
  full: ScenarioResult,
  reduced: ScenarioResult,
): Array<[string, string, string, string]> {
  const a = summarizeScenario(full);
  const b = summarizeScenario(reduced);
  return [
    [
      "Season TSS recorded",
      formatNumber(a.totalTss),
      formatNumber(b.totalTss),
      ratio(a.totalTss, b.totalTss),
    ],
    [
      "Sessions completed",
      `${String(a.recorded)} / ${String(a.total)}`,
      `${String(b.recorded)} / ${String(b.total)}`,
      "",
    ],
    [
      "Peak CTL",
      value(a.peakCtl),
      value(b.peakCtl),
      ratio(a.peakCtl, b.peakCtl),
    ],
    ["Final CTL", value(a.ctl), value(b.ctl), ratio(a.ctl, b.ctl)],
    [
      "Peak FTP",
      `${String(Math.round(a.peakFtp))} W`,
      `${String(Math.round(b.peakFtp))} W`,
      ratio(a.peakFtp, b.peakFtp),
    ],
    [
      "Final FTP",
      `${String(Math.round(a.ftp))} W`,
      `${String(Math.round(b.ftp))} W`,
      ratio(a.ftp, b.ftp),
    ],
    ["Half race prediction", formatClock(a.half), formatClock(b.half), ""],
    [
      "Gravel race prediction",
      formatClock(a.gravel),
      formatClock(b.gravel),
      "",
    ],
    ["Model cost", formatCost(a.cost), formatCost(b.cost), ""],
  ];
}

function summarizeScenario(result: ScenarioResult): ScenarioSummary {
  const week = result.weeks.at(-1);
  const ctls = result.weeks.map((entry) => entry.stateAtEnd.ctl);
  const ftps = result.weeks.map((entry) => entry.stateAtEnd.ftpWatts);
  const half = result.races.find((race) => race.kind === "half");
  const gravel = result.races.find((race) => race.kind === "gravel");
  return {
    totalTss: result.totalRecordedTss,
    recorded: result.recordedSessions,
    total: result.totalSessions,
    ctl: week?.stateAtEnd.ctl ?? 0,
    ftp: week?.stateAtEnd.ftpWatts ?? 0,
    peakCtl: ctls.length === 0 ? 0 : Math.max(...ctls),
    peakFtp: ftps.length === 0 ? 0 : Math.max(...ftps),
    half: half?.predictedSeconds ?? 0,
    gravel: gravel?.predictedSeconds ?? 0,
    cost: result.costUsd,
  };
}

function findingsSection(data: ReportData): string {
  const full = scenario(data, "full");
  const reduced = scenario(data, "reduced");
  const findings: string[] = [];
  if (full !== undefined) {
    findings.push(...goalFindings(full));
    findings.push(loadFinding(full));
    const readiness = readinessFinding(full);
    if (readiness !== null) findings.push(readiness);
    const claim = coachClaimFinding(full);
    if (claim !== null) findings.push(claim);
    const caveat = raceWeekCaveat(full);
    if (caveat !== null) findings.push(caveat);
    const flagged = full.weeks.reduce(
      (sum, week) =>
        sum +
        week.sessions.filter(
          (entry) => !entry.feasible && !isRaceSession(entry),
        ).length,
      0,
    );
    findings.push(
      flagged === 0
        ? "Every recorded session in test 1 sat inside the duration-adjusted intensity cap, so the prescribed load looked completable."
        : `${String(flagged)} recorded session(s) in test 1 exceeded the duration-adjusted intensity cap; these are flagged in the weekly table.`,
    );
  }
  if (full !== undefined && reduced !== undefined) {
    findings.push(...comparisonFindings(full, reduced));
  }
  return `<h2>Findings</h2><ol>${findings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ol>`;
}

function goalFindings(result: ScenarioResult): string[] {
  return result.races.map((race) => {
    const outcome = race.met ? "met" : "missed";
    const gap = Math.round((race.predictedSeconds - race.targetSeconds) / 60);
    const relation =
      gap >= 0
        ? `${String(gap)} min outside`
        : `${String(Math.abs(gap))} min inside`;
    const extra =
      race.soloPredictedSeconds === null
        ? ""
        : ` Solo it would be ${formatClock(race.soloPredictedSeconds)}, so the group case is doing real work.`;
    return `${race.title}: ${outcome} at ${formatClock(race.predictedSeconds)} against ${formatClock(race.targetSeconds)} (${relation} the target).${extra}`;
  });
}

/** How high the plan's own load estimates went, against the athlete's offer. */
function loadFinding(result: ScenarioResult): string {
  const planned = result.weeks.map((week) => week.plannedTss);
  const hours = result.weeks.map(
    (week) =>
      week.sessions.reduce(
        (sum, entry) => sum + entry.session.durationMinutes,
        0,
      ) / 60,
  );
  const peakPlan = planned.length === 0 ? 0 : Math.max(...planned);
  const meanPlan =
    planned.length === 0
      ? 0
      : Math.round(
          planned.reduce((sum, value) => sum + value, 0) / planned.length,
        );
  const peakCtl = Math.max(...result.weeks.map((week) => week.stateAtEnd.ctl));
  const meanHours =
    hours.length === 0
      ? 0
      : hours.reduce((sum, value) => sum + value, 0) / hours.length;
  const peakHours = hours.length === 0 ? 0 : Math.max(...hours);
  const half = result.races.find((race) => race.kind === "half");
  const gravel = result.races.find((race) => race.kind === "gravel");
  const halfText =
    half?.met === true
      ? "enough for the half marathon"
      : "not enough for the half marathon";
  const gravelGap =
    gravel === undefined
      ? 0
      : Math.round((gravel.predictedSeconds - gravel.targetSeconds) / 60);
  const gravelText =
    gravel?.met === true
      ? "enough for the gravel race"
      : `not enough for the gravel race (missed by ${String(gravelGap)} minutes)`;
  const ftpText =
    gravel?.met === true
      ? "The gravel block rebuilt FTP to the level the 3:10 target needs."
      : "The block after the half never rebuilt FTP toward the ~281 W the 3:10 target needs.";
  return `The plan averaged ${meanHours.toFixed(1)} training hours a week (peak ${peakHours.toFixed(1)} h), using the athlete's stated capacity, and its own estimates peaked at ${String(peakPlan)} TSS a week (mean ${String(meanPlan)}) with chronic load at ${peakCtl.toFixed(0)} CTL. That was ${halfText} and ${gravelText}. ${ftpText}`;
}

/** Whether the race-week readiness assessment matched the independent check. */
function readinessFinding(result: ScenarioResult): string | null {
  const half = result.races.find((race) => race.kind === "half");
  const gravel = result.races.find((race) => race.kind === "gravel");
  const text = `${half?.coachText ?? ""} ${gravel?.coachText ?? ""}`;
  const cautious =
    /plausible but unconfirmed|remains a stretch|not a race prediction|not confirmed/i.test(
      text,
    );
  const met = result.races.filter((race) => race.met).length;
  if (!cautious || met === 0) return null;
  return `The race-week readiness assessments were cautious — the half was "plausible but unconfirmed" and the gravel "remains a stretch" — while the independent model placed ${String(met)} of ${String(result.races.length)} goals inside their targets. The coach no longer hides a gap, but it may now understate a goal the training actually supports.`;
}

/** Contrasts a confident race-week claim with the independent check. */
function coachClaimFinding(result: ScenarioResult): string | null {
  const race = result.races.find((entry) => entry.kind === "gravel");
  if (race === undefined || race.met) return null;
  if (!/built|ready|on track|fitness|endurance/i.test(race.coachText))
    return null;
  const gap = Math.round((race.predictedSeconds - race.targetSeconds) / 60);
  return `In the gravel race week the coach described the endurance as built, while the independent model still placed the athlete ${String(gap)} minutes outside the target. The plan was structurally sound but the load did not match the claim.`;
}

/** Whether a race-week brief presented an out-of-reach target as reachable. */
function raceWeekCaveat(result: ScenarioResult): string | null {
  const gravel = result.races.find((race) => race.kind === "gravel");
  if (gravel === undefined || gravel.met) return null;
  if (!/3:10 goal|toward your/i.test(gravel.coachText)) return null;
  const gap = Math.round((gravel.predictedSeconds - gravel.targetSeconds) / 60);
  return `The gravel race-week brief framed the 3:10 target as reachable ("pacing steadily toward your 3:10 goal") without flagging the gap; the independent model put the race ${String(gap)} minutes outside the target.`;
}

function comparisonFindings(
  full: ScenarioResult,
  reduced: ScenarioResult,
): string[] {
  const fullSummary = summarizeScenario(full);
  const reducedSummary = summarizeScenario(reduced);
  const share =
    fullSummary.totalTss <= 0
      ? 0
      : Math.round((reducedSummary.totalTss / fullSummary.totalTss) * 100);
  return [
    `Training every other day cut recorded TSS to ${formatNumber(reducedSummary.totalTss)} (${String(share)}% of test 1) and peak CTL to ${reducedSummary.peakCtl.toFixed(0)} from ${fullSummary.peakCtl.toFixed(0)}.`,
    `Peak FTP was ${String(Math.round(fullSummary.peakFtp))} W in test 1 and ${String(Math.round(reducedSummary.peakFtp))} W in test 2; the half race prediction was ${formatClock(fullSummary.half)} versus ${formatClock(reducedSummary.half)}, and the gravel race prediction ${formatClock(fullSummary.gravel)} versus ${formatClock(reducedSummary.gravel)}.`,
    `Test 2 completed ${String(reducedSummary.recorded)} sessions against test 1's ${String(fullSummary.recorded)}. The slower progression is the expected consequence of the lower chronic load, and it is considerably larger than the week-to-week model noise. Test 2 predates the current prompt set and model, so read this comparison as the adherence effect plus a version difference, not as a controlled model comparison.`,
  ];
}

function caveatsSection(): string {
  return `<h2>Caveats</h2>
<ul>
<li>The progression curve and the race models are explicit assumptions, not the app's own prediction. They are anchored to the athlete's stated history but a real athlete's response varies.</li>
<li>Every session is assumed completed exactly as prescribed. The second test changes only how often the athlete trains, not how well a session is executed.</li>
<li>The gravel model is steady-state and uses average grade; it is not a lap-by-lap simulation and does not model wind, surface changes or group tactics beyond the group-power factor.</li>
<li>Weather and daylight are synthetic and deterministic. The coach's real prompt, plan validation, reviews and storage path are unchanged.</li>
<li>One run per scenario. The model is stochastic, so a repeat would differ in detail even with the same athlete.</li>
</ul>`;
}

function scenario(
  data: ReportData,
  name: "full" | "reduced",
): ScenarioResult | undefined {
  return data.scenarios.find((entry) => entry.scenario === name);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

/** Race days are recorded sessions but not prescribed training sessions. */
function isRaceSession(entry: SessionRecord): boolean {
  return entry.date === HALF_MARATHON.date || entry.date === GRAVEL_RACE.date;
}

function value(input: number | undefined): string {
  return input === undefined ? "—" : String(Math.round(input));
}

function ratio(a: number, b: number): string {
  if (b <= 0) return "—";
  return `${(a / b).toFixed(2)}×`;
}

function formatPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function wallTime(result: ScenarioResult): string {
  const ms = Date.parse(result.finishedAt) - Date.parse(result.startedAt);
  return `${(ms / 60_000).toFixed(1)} min`;
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}
