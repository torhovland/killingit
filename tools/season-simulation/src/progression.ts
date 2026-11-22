import { addDays } from "@killingit/shared";
import { CTL_FULL_REGAIN, REGAIN_EXPONENT } from "./course.js";
import type { AthleteProfile, AthleteState, Capability } from "./types.js";

/** The chronic-load time constant the app uses for CTL. */
const CTL_DAYS = 42;

/** The athlete on the first day: no chronic load and the stated baseline. */
export function initialAthleteState(
  profile: AthleteProfile,
  date: string,
): AthleteState {
  return {
    date,
    ctl: 0,
    ftpWatts: profile.startFtpWatts,
    runThresholdSecPerKm: profile.startRunThresholdSecPerKm,
  };
}

/**
 * Maps chronic load to ability. The athlete regains the gap to the prior peak
 * with diminishing returns; the model never projects beyond that peak. This is
 * a simulation assumption, not app logic.
 */
function capabilityFromCtl(profile: AthleteProfile, ctl: number): Capability {
  const fraction = Math.min(
    1,
    Math.max(0, ctl / CTL_FULL_REGAIN) ** REGAIN_EXPONENT,
  );
  return {
    ftpWatts:
      profile.startFtpWatts +
      (profile.priorFtpWatts - profile.startFtpWatts) * fraction,
    runThresholdSecPerKm:
      profile.startRunThresholdSecPerKm -
      (profile.startRunThresholdSecPerKm - profile.priorRunThresholdSecPerKm) *
        fraction,
  };
}

/** Applies one day of training stress, then reads the resulting ability. */
export function advanceAthleteState(
  state: AthleteState,
  date: string,
  tss: number,
  profile: AthleteProfile,
): AthleteState {
  const ctl = state.ctl + (Math.max(0, tss) - state.ctl) / CTL_DAYS;
  return { date, ctl, ...capabilityFromCtl(profile, ctl) };
}

/**
 * Advances the rest days before `date` without touching `date` itself. The
 * caller applies the session's own TSS on `date`, so a training day is one EWMA
 * step, not a zero step followed by a training step.
 */
export function advanceThroughDate(
  state: AthleteState,
  date: string,
  profile: AthleteProfile,
): AthleteState {
  let next = state;
  while (addDays(next.date, 1) < date) {
    next = advanceAthleteState(next, addDays(next.date, 1), 0, profile);
  }
  return next;
}
