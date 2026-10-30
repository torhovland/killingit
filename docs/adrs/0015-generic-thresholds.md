# ADR 0015: Generic threshold measurements per sport

## Context

The app originally stored only cycling FTP in `athlete_metrics` and used it for
power TSS, the estimated-FTP chart, and the plan's week-by-week estimate. That
model does not fit runners, swimmers, rowers, or an athlete who also has a
threshold heart rate: a threshold is a property of a sport, and a sport may have
more than one.

## Decision

Store thresholds in a dedicated `athlete_thresholds` table keyed by
`(user, sport, measure, date)`. Each row also carries a display label, unit, and
kind. The kind decides how an activity is scored; the sport decides which
threshold applies. Both sport and measure are free text with canonical
normalisation, so a new sport or measure does not require a schema change.

The coach reads threshold statements from the athlete's own words. A threshold
with no stated sport is not guessed: the app asks the athlete which sport it is
for and includes the answer in the next reading. Cycling FTP from Garmin and
existing stored FTP points migrate into the new table, and the legacy FTP
helpers remain as a compatibility layer for the plan's power-specific estimate
and downloadable bike workouts.

The Fitness page returns one series per measure and draws them grouped by unit.
Plan views show every known measure instead of the single FTP value. Activity
TSS prefers power, then pace or speed, then heart rate for the activity's sport,
and keeps the duration fallback when no usable threshold exists.

## Consequences

- A new threshold measure or sport is data, not a migration.
- Mixed-sport athletes are scored with the right threshold.
- The plan still estimates FTP for bike power targets; other measures are
  displayed from their measured history rather than invented projections.
- Asking for a missing sport adds one clarification question, and the value is
  stored only after the answer.
