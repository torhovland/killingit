import type { BikeWorkout } from "@killingit/shared";

export interface ZwoWorkoutInput {
  title: string;
  description: string;
  workout: BikeWorkout;
}

/**
 * Builds a Zwift workout (.zwo) file from a structured indoor bike session.
 * Every interval becomes a steady-state step at a percentage of FTP, which is
 * what the ZWO format expects.
 */
export function buildZwoWorkout(input: ZwoWorkoutInput): string {
  const steps = input.workout.intervals.map(
    (interval) =>
      `    <SteadyState Duration="${interval.durationSeconds}" Power="${formatPower(interval.powerPercent)}"/>`,
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<workout_file>",
    "  <author>Killing It</author>",
    `  <name>${escapeXml(input.title)}</name>`,
    `  <description>${escapeXml(input.description)}</description>`,
    "  <sportType>bike</sportType>",
    "  <tags/>",
    "  <workout>",
    ...steps,
    "  </workout>",
    "</workout_file>",
    "",
  ].join("\n");
}

/**
 * A stable, ASCII-only download name. Browsers and trainer apps handle spaces
 * and punctuation poorly in these files, so the title becomes a slug.
 */
export function zwoFilename(date: string, title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${date}-${slug === "" ? "workout" : slug}.zwo`;
}

/** ZWO stores power as a fraction of FTP (75% becomes 0.75). */
function formatPower(powerPercent: number): string {
  return Number((powerPercent / 100).toFixed(4)).toString();
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
