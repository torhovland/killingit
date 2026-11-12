import {
  FORM_INTERPRETATION_LABELS,
  interpretTrainingStressBalance,
  type BikeWorkout,
  type BlockPlan,
  type CoachPlan,
  type DayPlan,
  type DietProgress,
  type SeasonPlan,
  type TrainingLoad,
  type WeekPlan,
  type WeekSession,
} from "@killingit/shared";

/** Renders the season plan as an ordered block overview. */
export function formatSeasonPlan(plan: SeasonPlan): string {
  const lines = [
    `Goal: ${plan.goal}`,
    `Dates: ${plan.startDate} → ${plan.endDate}${plan.estimatedFtpWatts != null ? ` — estimated FTP ${plan.estimatedFtpWatts} W` : ""}`,
  ];
  if (plan.dietProgress != null) {
    lines.push(
      `Diet progress by the end of the season: ${formatDietProgress(plan.dietProgress)}`,
    );
  }
  lines.push(
    `Rationale: ${plan.rationale}`,
    "Blocks:",
    ...plan.blocks.flatMap((block, index) => [
      `${index + 1}. ${block.name} (${block.startDate} → ${block.endDate}, ${block.weekCount} weeks): ${block.focus}`,
      ...(block.dietProgress != null
        ? [
            `   Diet progress by the end of this block: ${formatDietProgress(block.dietProgress)}`,
          ]
        : []),
    ]),
  );
  return lines.join("\n");
}

/** Renders the detailed block plan and its weekly progression. */
export function formatBlockPlan(plan: BlockPlan): string {
  const lines = [
    `Block: ${plan.name}`,
    `Focus: ${plan.focus}`,
    `Dates: ${plan.startDate} → ${plan.endDate}${plan.estimatedFtpWatts != null ? ` — estimated FTP ${plan.estimatedFtpWatts} W` : ""}`,
  ];
  if (plan.dietProgress != null) {
    lines.push(
      `Diet progress by the end of the block: ${formatDietProgress(plan.dietProgress)}`,
    );
  }
  lines.push(
    `Rationale: ${plan.rationale}`,
    "Weeks:",
    ...plan.weeks.map((week) => {
      const progress =
        week.dietProgress != null
          ? `; diet progress by the end of the week: ${formatDietProgress(week.dietProgress)}`
          : "";
      return `- Week ${week.number} (from ${week.startDate}): ${week.focus}; target load: ${week.targetLoad}${week.estimatedFtpWatts != null ? `; estimated FTP ${week.estimatedFtpWatts} W` : ""}${progress}`;
    }),
  );
  return lines.join("\n");
}

/** One target line for a plan period. Assumes the progress object exists. */
function formatDietProgress(progress: DietProgress): string {
  const targets: string[] = [];
  if (progress.targetWeightKg !== null) {
    targets.push(`${progress.targetWeightKg.toFixed(1)} kg`);
  }
  if (progress.targetBodyFatPercent !== null) {
    targets.push(`${progress.targetBodyFatPercent.toFixed(1)} % body fat`);
  }
  const targetText =
    targets.length > 0 ? targets.join(" and ") : "no numeric target";
  return `${targetText}. ${progress.note.trim()}`;
}

/** Renders the current week's seven sessions. */
export function formatWeekPlan(plan: WeekPlan): string {
  const lines = [
    `Week starting ${plan.startDate} — focus: ${plan.focus}${plan.estimatedFtpWatts != null ? ` — estimated FTP ${plan.estimatedFtpWatts} W` : ""}`,
  ];
  if (plan.dietProgress != null) {
    lines.push(
      `Diet progress by the end of the week: ${formatDietProgress(plan.dietProgress)}`,
    );
  }
  lines.push(
    `Rationale: ${plan.rationale}`,
    "Sessions:",
    ...plan.sessions.map((session) => {
      const tss =
        session.estimatedTss !== undefined
          ? `; estimated TSS ${session.estimatedTss}`
          : "";
      const load =
        session.trainingLoad != null
          ? `; ${formatTrainingLoad(session.trainingLoad)}`
          : "";
      return `- ${session.date} (${session.day}) [${session.status}]: ${formatPlannedSession(session)}${tss}${load}`;
    }),
  );
  return lines.join("\n");
}

/**
 * One compact training-load snapshot. It uses the same labels as the app's
 * views, so the prompt and the UI cannot describe the same TSB differently.
 */
export function formatTrainingLoad(load: TrainingLoad): string {
  const label =
    FORM_INTERPRETATION_LABELS[interpretTrainingStressBalance(load.tsb)];
  return `ATL ${load.atl} · CTL ${load.ctl} · TSB ${load.tsb} · ${label}`;
}

/**
 * Renders one concrete day plan for a prompt. The week plan only carries the
 * session summary; a day plan also carries alternatives and the optionality
 * guidance, so the update prompt can see the full current day.
 */
export function formatDayPlan(plan: DayPlan): string {
  const lines = [
    `Date: ${plan.date}`,
    `Title: ${plan.title}`,
    `Type: ${plan.type}; intensity: ${plan.intensity}; duration: ${plan.durationMinutes} min; status: ${plan.status}`,
    `Description: ${plan.description}`,
    `Rationale: ${plan.rationale}`,
  ];
  if (plan.alternatives !== undefined && plan.alternatives.length > 0) {
    lines.push(`Alternatives: ${plan.alternatives.join("; ")}`);
  }
  if (plan.optional) {
    lines.push(
      `Optional: true${plan.optionalRationale !== undefined ? ` — ${plan.optionalRationale}` : ""}`,
    );
  }
  if (plan.outdoor !== undefined) {
    lines.push(`Outdoor: ${plan.outdoor}`);
  }
  if (plan.canBeOutdoor !== undefined) {
    lines.push(`Can be outdoor: ${plan.canBeOutdoor}`);
  }
  if (plan.bikeWorkout != null) {
    lines.push(`Bike workout: ${formatBikeWorkout(plan.bikeWorkout)}`);
  }
  if (plan.estimatedTss !== undefined) {
    lines.push(`Estimated TSS: ${plan.estimatedTss}`);
  }
  if (plan.trainingLoad !== undefined && plan.trainingLoad !== null) {
    lines.push(`Projected load: ${formatTrainingLoad(plan.trainingLoad)}`);
  }
  return lines.join("\n");
}

/**
 * The season and current block, rendered the same way for every prompt that
 * starts from the athlete's current plan.
 */
export function formatSeasonAndBlock(
  season: SeasonPlan,
  block: BlockPlan,
): string[] {
  return [
    "Current season plan:",
    formatSeasonPlan(season),
    "",
    "Current block plan:",
    formatBlockPlan(block),
  ];
}

/**
 * The season, current block and current week, rendered the same way for every
 * prompt that starts from the athlete's current plan.
 */
export function formatPlanLevels(
  plan: Pick<CoachPlan, "season" | "block" | "week">,
): string[] {
  return [
    ...formatSeasonAndBlock(plan.season, plan.block),
    "",
    "Current week plan:",
    formatWeekPlan(plan.week),
  ];
}

/**
 * Renders the one-line session summary shared by the coach reply and the
 * activity review, including a bike workout's power targets when it has one.
 */
export function formatPlannedSession(session: WeekSession): string {
  const bikeWorkout =
    session.bikeWorkout != null
      ? `; ${formatBikeWorkout(session.bikeWorkout)}`
      : "";
  return `${session.title} [${session.type}, ${session.intensity}, ${session.durationMinutes} min] — ${session.description}${bikeWorkout}`;
}

/** Renders a structured bike workout's power targets for a generation prompt. */
function formatBikeWorkout(workout: BikeWorkout): string {
  const intervals = workout.intervals
    .map(
      (interval) =>
        `${interval.durationSeconds}s at ${interval.powerPercent}% FTP`,
    )
    .join(", ");
  return `power targets at FTP ${workout.ftpWatts} W: ${intervals}`;
}
