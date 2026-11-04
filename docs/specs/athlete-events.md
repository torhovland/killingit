# Spec: Athlete goals and events

- **Status:** Accepted (implemented)
- **Date:** 2026-11-04
- **Related:** `docs/specs/calendar-page.md`,
  `docs/specs/coach-plan-lifecycle.md`, `docs/specs/athlete-question-answers.md`,
  `docs/specs/coach-reply-context.md`, `docs/specs/threshold-metrics.md`.

## Goal

Surface the dated goals and events the athlete states in their own words — a
race, a sportive, a trip, a dated target — on the Calendar page and on the Week
and Day plan tabs, and give the coach the same list when it plans.

## Scope

### In scope

1. A dedicated coach reading of every dated goal or event in the athlete's
   survey answers, activity comments, manual activities, weekly notes, period
   review comments, and answered coach questions.
2. A stored `athlete_events` list per account, replaced by each successful
   reading, newest first, so an event edited out of a comment disappears.
3. The stored events are added to the plan prompts, so the coach plans around a
   race, a taper, or a trip.
4. `GET /api/calendar` returns each day's events and each Monday week's planned
   and completed time and TSS.
5. `GET /api/coaching/plan` returns the stored events, and the Day and Week tabs
   list the events that fall on or inside the day or week.
6. The calendar's week box shows completed and planned time and TSS.

### Out of scope (deferred)

- Creating or editing an event by hand. Every event comes from the athlete's own
  words; there is no event form.
- Repeating events (for example "every Tuesday").
- Reminders or notifications for an event.
- Showing an event that has already passed. The reading reports events from
  today onward, because a past event is normally already a recorded activity.

## Behaviour

### Reading

- `syncAthleteEvents` runs before a plan generation, beside the existing
  `syncAthleteMetrics` reading, and is fail-open: a model or database failure
  keeps the stored events and never blocks the plan.
- The source is the same athlete-authored text the metrics reading uses, plus
  every stored weekly note, not only the current week's note. Each entry carries
  the date it was written and a label naming where it came from.
- The reading returns `{ events, coachQuestion, modelsRemarks }`. A clarification
  question is stored like any other coach question.
- Each event has `startDate`, a nullable `endDate` (a one-day event has none), a
  short `title`, and a `kind`: `race`, `event`, `trip`, or `goal`.
- Only a date the athlete states or that is unambiguous against today's date is
  reported. A vague period such as "sometime in spring" is not a date. The
  reading never invents an event and never turns a coach-planned session or a
  recorded activity into one.
- A successful reading replaces every stored event for the account. The model
  receives all of the athlete's text, so an event removed from a comment is not
  returned and disappears. Future dates are kept; past dates are skipped.

### Calendar

- A day's events are attached to every day the event covers, so a three-day
  trip appears on all three days.
- Events extend the calendar's earliest and latest bounds, so a month the
  athlete mentions is reachable from the month picker.
- Each Monday week carries `stats`: planned minutes, planned TSS, completed
  minutes, and completed TSS.
  - Planned time and TSS come from the stored plan's workout sessions for that
    week: the session's duration and its `estimatedTss` (or projected load).
  - Completed time is the recorded elapsed time of imported activities.
  - Completed TSS is each imported activity's own `activityTss`, falling back to
    the day's load once per day on older payloads, plus a manual entry's
    estimated TSS. A manual entry carries no duration, so it adds no time.
- A week with no stored plan and no activity still carries zeroed stats, so
  every row shows a consistent box.

### Week and Day plan tabs

- The plan response carries the stored events.
- The Day tab lists every event whose range includes today's or tomorrow's date,
  above the session card.
- The Week tab lists every event whose range overlaps the week, above the
  session list.
- An event is shown with its kind, title, and date (or date range).

## Data model / API impact

Shared (`@killingit/shared`):

- `event.ts`: `athleteEventKindSchema`, `athleteEventSchema`,
  `athleteEventsResultSchema`, `eventCoversDate`, `eventOverlapsRange`, and
  `formatEventDates`.
- `calendar.ts`: `calendarDaySchema.events`, `calendarWeekStatsSchema`, and
  `calendarWeekSchema.stats`.
- `plan.ts`: `coachPlanResponseSchema.events`.

API:

- `apps/api/src/db/schema.ts`: `athlete_events`.
- `apps/api/src/llm/athleteEventsPrompt.ts` and `athleteEvents.ts`: the reading
  and its prompt.
- `apps/api/src/coaching/athleteEvents.ts`: the source builder and the fail-open
  sync.
- `apps/api/src/events/store.ts`: `loadAthleteEvents` and
  `replaceAthleteEvents`.
- `apps/api/src/plans/trigger.ts`: runs the reading and passes the stored events
  into the plan context.
- `apps/api/src/llm/planContext.ts`: renders the events for every prompt that
  carries the athlete context.
- `apps/api/src/llm/promptRules.ts`: `ATHLETE_EVENT_RULES`, part of
  `PLAN_PROMPT_RULES`.
- `apps/api/src/routes/calendar.ts`: events per day, week stats, and bounds.
- `apps/api/src/routes/plan.ts`: events in the plan response.
- One Drizzle migration for `athlete_events` and the new `athlete_events` prompt
  kind.

## Acceptance criteria

1. A dated event stated in a survey answer or a comment is stored and shown on
   the calendar's matching day, on the Week tab of the week it falls in, and on
   the Day tab when it falls on today or tomorrow.
2. Editing or removing the statement removes the event after the next reading.
3. A model failure leaves the previously stored events untouched.
4. The calendar's week box shows completed and planned time and TSS.
5. The plan prompts receive the stored events.
6. Typecheck, lint, format, and tests pass.

## Testing

- API unit tests for the event source, the prompt, and the sync's replace and
  fail-open behaviour.
- Calendar route tests for event days, bounds, and week stats (planned and
  completed time and TSS).
- Plan route test for the events in the response.
- Web render tests for the calendar event chip, the week statistics, and the
  Day and Week event lists.
