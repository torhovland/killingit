import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnalyzedActivity } from "@killingit/shared";
import type {
  AthleteState,
  CallRecord,
  RaceResult,
  ScenarioName,
  WeekRecord,
} from "./types.js";

interface PendingRefresh {
  today: string;
  mode: "auto" | "newSeason";
}

/** Everything a resumed run needs that is not already in PostgreSQL. */
export interface SimulationStateFile {
  scenario: ScenarioName;
  userId: number;
  startedAt: string;
  today: string;
  nextId: number;
  state: AthleteState;
  activities: AnalyzedActivity[];
  weeks: WeekRecord[];
  races: RaceResult[];
  notes: string[];
  calls: CallRecord[];
  pendingRefresh: PendingRefresh | null;
}

function statePath(directory: string, scenario: ScenarioName): string {
  return join(directory, `state-${scenario}.json`);
}

/** Reads a saved run, or null when this is a fresh start. */
export async function readSimulationState(
  directory: string,
  scenario: ScenarioName,
): Promise<SimulationStateFile | null> {
  try {
    const text = await readFile(statePath(directory, scenario), "utf8");
    return JSON.parse(text) as SimulationStateFile;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/** Saves after every week and around every refresh, so a failure is resumable. */
export async function writeSimulationState(
  directory: string,
  state: SimulationStateFile,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const path = statePath(directory, state.scenario);
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Removes the saved run after a clean finish. */
export async function clearSimulationState(
  directory: string,
  scenario: ScenarioName,
): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(statePath(directory, scenario), { force: true });
}
