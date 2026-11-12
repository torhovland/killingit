import { formatDuration, type StrengthSet } from "@killingit/shared";

/**
 * A readable exercise label from Garmin's FIT enum values, preferring the
 * sub-category name over the parent category when both are present.
 */
function exerciseLabel(set: StrengthSet): string {
  const exercise = set.exercises[0];
  const raw = exercise?.name ?? exercise?.category ?? "Set";
  const words = raw.trim().toLowerCase().replace(/[_-]+/g, " ").split(/\s+/);
  const label = words.filter((word) => word !== "").join(" ");
  return label === ""
    ? "Set"
    : `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

interface StrengthGroup {
  label: string;
  repetitions: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  count: number;
}

/** Groups identical active sets so a 5×5 session reads as one line. */
function strengthGroups(sets: readonly StrengthSet[]): StrengthGroup[] {
  const groups = new Map<string, StrengthGroup>();
  for (const set of sets) {
    if (set.setType === "rest") {
      continue;
    }
    const repetitions = set.repetitions ?? null;
    const weightKg = set.weightKg ?? null;
    const durationSeconds = set.durationSeconds ?? null;
    const label = exerciseLabel(set);
    const key = `${label}\u0000${repetitions}\u0000${weightKg}\u0000${durationSeconds}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        label,
        repetitions,
        weightKg,
        durationSeconds,
        count: 1,
      });
    } else {
      group.count += 1;
    }
  }
  return [...groups.values()];
}

function formatStrengthGroup(group: StrengthGroup): string {
  const work =
    group.repetitions !== null
      ? `${group.count} × ${group.repetitions} reps`
      : group.durationSeconds !== null
        ? `${group.count} × ${formatDuration(group.durationSeconds)}`
        : `${group.count} ${group.count === 1 ? "set" : "sets"}`;
  return group.weightKg !== null
    ? `${group.label}: ${work} at ${group.weightKg} kg`
    : `${group.label}: ${work}`;
}

function restRange(sets: readonly StrengthSet[]): string | null {
  const rests = sets
    .filter((set) => set.setType === "rest")
    .map((set) => set.durationSeconds)
    .filter((value): value is number => value !== undefined && value > 0);
  if (rests.length === 0) {
    return null;
  }
  const least = Math.round(Math.min(...rests));
  const most = Math.round(Math.max(...rests));
  return least === most
    ? `Rest between sets: ${least} s`
    : `Rest between sets: ${least}-${most} s`;
}

/** One compact line describing the recorded work, for the plan prompt. */
export function summarizeStrengthSets(sets: readonly StrengthSet[]): string {
  const parts = strengthGroups(sets).map(formatStrengthGroup);
  const rest = restRange(sets);
  if (rest !== null) {
    parts.push(rest);
  }
  return parts.join("; ");
}

/** Renders the recorded strength work for an activity-review prompt. */
export function formatStrengthSets(sets: readonly StrengthSet[]): string[] {
  const groups = strengthGroups(sets);
  const rest = restRange(sets);
  if (groups.length === 0 && rest === null) {
    return [];
  }
  return [
    "Recorded strength sets:",
    ...groups.slice(0, 40).map((group) => `- ${formatStrengthGroup(group)}`),
    ...(rest !== null ? [`- ${rest}`] : []),
  ];
}
