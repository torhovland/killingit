# Coach runs: latest input wins

## Goal

When the athlete answers several pending comments in quick succession, the app
should not queue one plan refresh after another. The newest input starts one
coach run, an older in-flight run is cancelled, and only the newest run may
write replies, the plan, or its status.

Replies stay fast: the run answers every unanswered activity comment in one
short completion before it starts the slower plan refresh.

## Behaviour

1. Saving an activity comment stores it and starts a background coach run. The
   HTTP response returns immediately with no reply; the dashboard polls for the
   reply while the run works.
2. The run claims the user's generation row with a new `runId`. Starting a run
   aborts the previous run's provider requests in the same process.
3. The first phase asks the coach to answer every activity comment that has no
   stored reply in one completion. The replies are stored as soon as that
   completion succeeds, before the plan phase starts.
4. The second phase runs the existing plan generation. It uses the same run id
   and abort signal.
5. If a second comment is saved while the first run is working, the second run
   claims the row, aborts the first run, and answers both comments before
   planning. The first run stops without writing anything.
6. When a non-superseded run completes, the dashboard reloads the activity feed
   (for replies) and the plan.

## Cancellation

OpenRouter has no cancel endpoint for a non-streaming completion. Aborting the
HTTP request is best-effort: it stops the app waiting and may stop provider work,
but it cannot guarantee the provider stops billing.

Cancellation is therefore paired with a run fence:

- `plan_generations.run_id` identifies the current owner.
- `begin` always claims the row for the newest run.
- `update`, `heartbeat`, `finish` and `fail` only touch a row whose run id still
  matches.
- `plans.save` locks and checks the generation row before writing.
- Coach questions, FTP/body estimates, activity reviews and period reviews are
  not written by a superseded run.
- An aborted or superseded run does not mark its prompt log rows as plan
  failures.

The in-process `AbortController` map only reaches the instance handling the old
request. The database run id is the cross-instance fence: an old run on another
instance notices at its next check and stops before writing.

## Reply batching

`replyToUnansweredActivityComments` loads every activity comment without a
`coach_replies` row, builds one prompt listing all of them with stable ids, and
saves the returned replies by id. A comment whose id is missing from the
response is left unanswered for the next run.

The single-input reply paths (weekly note, manual activity, review comment,
coach question) keep their existing prompts. They still trigger a run, so a new
input supersedes an older plan refresh.

## UI

- A comment save adds the activity to the visit's kept list and returns at once.
- While any activity has a comment but no coach reply, the dashboard polls
  `GET /api/coaching/activities/cached` every 1.5 seconds for up to one minute
  and merges new replies into the feed on screen. The activity card shows
  `Coach: thinking…` under the athlete's comment until the reply replaces it.
- The plan section continues to poll generation status. A superseded run never
  writes `done` or `error`; the new run owns the status row, so polling follows
  the newest run.

## Acceptance criteria

- Two comments saved while a run is active produce one superseded run and one
  current run that answers both comments.
- The current run's replies are visible before the plan refresh finishes.
- A superseded run cannot overwrite the plan, mark the new run done or failed,
  or record its coach questions and metric estimates.
- An aborted completion is not retried by the reasoning-model fallback cascade.
- Deleting an activity, saving a manual activity, or saving a weekly note still
  refreshes the plan, and a newer save supersedes that refresh.
