# Spec: Delete imported and manual activities

- **Status:** Accepted (implemented)
- **Date:** 2026-10-22
- **Related:** `docs/specs/garmin-activity-integration.md`,
  `docs/specs/coach-feedback-and-program-review.md`,
  `docs/specs/coach-plan-lifecycle.md`, ADR 0003.

## Goal

Let an athlete remove an activity from their coaching view, whether it was
imported from Garmin or entered manually. Removing it also removes its saved
comment and coach reply and starts a plan revision so the coach no longer treats
the activity as completed training.

## Scope

### In scope

1. **Imported activities (Garmin).** Deleting an imported activity hides it from
   the activity feed and from plan generation. Garmin Connect is the source of
   truth and is not modified: the next sync returns the activity again, so the
   app stores a per-user tombstone and filters it out.
2. **Manual activities.** Deleting a manual activity removes its
   `manual_activities` row.
3. **Associated input.** Deletion removes the athlete's comment and the coach's
   reply for that activity (and, for a manual activity, the coach reply attached
   to the manual row).
4. **Plan revision.** A deletion records a timestamp in the same
   coaching-input stream that already makes a plan stale, so the week and today
   are revised without rebuilding the season or block.
5. **UI.** Imported activity cards and saved manual activities each have a
   Delete action with a confirmation prompt.

### Out of scope

- Deleting the activity in Garmin Connect.
- Deleting a cached general/program analysis. Analyses are a shared cache keyed
  by activity id and are harmless once the activity is hidden.
- Undo/restore. The tombstone is deliberately one-way for now.
- Background deletion jobs; deletion is synchronous with the request.

## Data model

### `activity_deletions`

| column        | type                 | notes                                   |
| ------------- | -------------------- | --------------------------------------- |
| `id`          | serial               | primary key                             |
| `user_id`     | integer              | FK to `users`, cascade on user deletion |
| `source`      | `garmin` \| `manual` | where the deleted activity came from    |
| `activity_id` | text                 | Garmin id or manual activity id         |
| `created_at`  | timestamptz          | default now                             |
| `updated_at`  | timestamptz          | default now                             |

Unique `(user_id, source, activity_id)` keeps deletion idempotent. For manual
activities the row is deleted from `manual_activities`; the tombstone remains
so `loadCoachingInputs` can include its timestamp in `updatedAt` and the plan
detects the change.

## API

Both routes are behind `requireAuth` and scoped to the signed-in account. They
take `today` (required) and `timezone` (optional) as query parameters and return
`{ message, reply: null }` so the existing client save-response parser works.

- `DELETE /api/coaching/activities/:activityId`
  - Records a `garmin` deletion (idempotent), clears the activity's comment and
    coach reply, and triggers plan generation.
- `DELETE /api/coaching/activities/manual/:id`
  - Deletes the row if it belongs to the user (404 otherwise), records a
    `manual` deletion, clears attached feedback, and triggers plan generation.

`GET /api/coaching/activities` filters out `garmin` tombstones before sorting
and slicing the feed. Plan generation uses the same filtered feed.

## Behavior

- Deleting an imported activity does not stop the Garmin sync from returning it;
  the filter runs after the sync.
- Deleting a manual activity dated today is treated like any other deletion:
  `keepToday` is not set, so today's session may be revised because the recorded
  training no longer exists.
- A failed LLM reply is irrelevant: deletion never calls the LLM.
- If plan generation is already running, the trigger returns false; the deletion
  still succeeds and the running generation picks up the new state.

## UI

- `ActivityCard` gets an optional `onDelete` handler and renders a Delete button
  only when it is supplied. The card confirms, shows a busy state, and surfaces
  an error if the request fails.
- `CoachDashboard` removes a deleted imported activity from local state, reloads
  manual activities after a manual deletion, and bumps the plan refresh key in
  both cases.
- Saved manual activities show Edit and Delete actions side by side.

## Acceptance criteria

1. An imported activity can be deleted and stays hidden across visits and Garmin
   syncs.
2. A manually entered activity can be deleted and no longer appears in the
   coaching inputs or plan.
3. Deleting either kind removes its comment and coach reply.
4. Either deletion starts a plan revision.
5. Deleting an unknown manual activity returns 404; a missing `today` returns 400.
6. Unit tests cover the routes and the activity card's delete affordance, and
   `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.
