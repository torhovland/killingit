# Spec: Focused coaching page components

- **Status:** Accepted (implemented)
- **Date:** 2026-11-08
- **Related:** `docs/specs/web-coaching-hooks.md`,
  `docs/specs/dashboard-layout.md`, `docs/specs/period-reviews.md`,
  `docs/specs/coach-questions.md`

## Goal

Make the two activity-facing pages read as a list of sections instead of one
large render tree. `CoachDashboard` and `ActivitiesPage` keep their layout and
the wiring between sections; the data loading, form state and markup for each
section live in a focused hook or component.

This follows ADR-free tech-debt work: no route, schema or coach behaviour
changes.

## Target structure

- `apps/web/src/useCoachReviews.ts` — loads completed-period reviews, tracks the
  reviews kept for the rest of the visit, saves a review comment and marks a
  review as reviewed without a comment.
- `apps/web/src/plan/useCoachPlan.ts` — loads the stored plan and today's diet
  summary, runs the refresh-key reload and the track/start decision tree, and
  exposes the newest tracked response instead of copying it into local state.
- `apps/web/src/plan/usePlanWorkoutDownload.ts` — the authenticated workout-file
  fetch, the browser save, the in-flight date and the download error.
- `apps/web/src/useCoachQuestion.ts` — loads the pending coach question and
  answers it.
- `apps/web/src/useManualActivities.ts` — loads the athlete's manual activities,
  owns the edit target, and deletes an entry.
- `apps/web/src/WeeklyNoteCard.tsx` — the weekly note form and the coach's reply.
- `apps/web/src/QuickQuestionCard.tsx` — the by-the-way form and answer.
- `apps/web/src/CoachingInputsSection.tsx` — the "Talk to the coach" section
  that composes the two cards.
- `apps/web/src/ActivityList.tsx` — renders activity cards, with an optional
  empty message.
- `apps/web/src/PendingActivitiesSection.tsx` — the dashboard's pending activity
  heading plus `ActivityList`.
- `apps/web/src/PendingReviewsList.tsx` — the completed-training section with
  its block and week review groups.
- `apps/web/src/ManualActivityForm.tsx` — the add/edit manual activity form.
- `apps/web/src/ManualActivityList.tsx` — saved manual activities with edit and
  delete actions.
- `apps/web/src/plan/CoachPlanSection.tsx` — the plan card's layout, composing
  `useCoachPlan`, `usePlanWorkoutDownload` and `CoachPlanView`.
- `apps/web/src/plan/CoachPlanView.tsx` — the tab shell, rendering the plan levels
  through the shared `Tabs` primitive. It receives the plan's `pending` levels
  and whether a run is `running` once, and dims each level whose replacement is
  in flight.
- `apps/web/src/CoachDashboard.tsx` and `apps/web/src/ActivitiesPage.tsx` —
  composition and layout only.

## Acceptance criteria

1. Both page components are under roughly 250 lines and read as a sequence of
   named sections.
2. The activity feed, statuses, reviews, coach questions, weekly note,
   by-the-way question and manual-activity behaviour are unchanged, including
   the dashboard's keep-answered rule, reply polling, plan refresh keys and
   retry states.
3. The extracted components are presentational where possible and are covered
   by render and interaction tests; a test is only edited when a prop seam it
   exercises changes, and no assertion is dropped.
4. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.
5. The plan section's generated output is unchanged: the loaded plan, the diet
   summary, the loading and error paths, and the per-level refresh greying all
   render as before.

## Out of scope

- Changing API routes, payloads or prompt context.
- Changing the order of dashboard sections or the text they show.
