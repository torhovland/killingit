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
   HTTP response returns immediately with no reply; the dashboard marks the
   comment in its local feed and polls for the reply while the run works.
2. The run claims the user's generation row with a new `runId`. Starting a run
   aborts the previous run's provider requests in the same process. Auto
   triggers that arrive within 1.5 s of the previous one are coalesced: the
   newest trigger still claims the row, but the plan work waits for the short
   window to close, so a burst of saved inputs starts one run instead of several
   aborted ones. The first trigger starts immediately, and explicit new-season,
   update-season and forced runs are never delayed.
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

## Process-local state

Every map the run guarantee relies on lives in one process, so the bounds below
make memory predictable without turning any of them into a cross-instance lock.
On Cloud Run, where several instances may serve the same account, two instances
can each debounce a trigger or run an activity-analysis pass; a model-catalog
refresh is still gated by its sync row. The database run id still stops every
stale write.

- `activeRuns` (`apps/api/src/plans/runs.ts`) keeps one entry per live run. A
  newer run replaces it, a settled run releases it, and a run whose generation
  row could not be claimed is released before the trigger throws, so the map is
  bounded by the runs in flight.
- `pendingStarts` (`apps/api/src/plans/trigger.ts`) only holds triggers waiting
  for their debounce timer, and the timer removes its own entry.
- `lastTriggerAt` is a `RecentTimestampMap` that prunes every time outside the
  current debounce window, so it holds only the accounts triggered inside that
  window instead of every account that ever generated a plan.
- `reportedInvalidPlans` (`apps/api/src/plans/store.ts`) keeps the newest 256
  user-and-save-time keys. A corrupt row that is still read after its key was
  evicted is reported once more, which trades bounded repeat logging for bounded
  memory.
- `completedAnalyses` (`apps/api/src/coaching/analysisRuns.ts`) keeps one
  finished feed for each of the 32 most recently used accounts. `activeAnalyses`
  removes an entry when its pass settles. Reading a finished feed refreshes its
  account, so a plan that is waiting on the same athlete day keeps its feed while
  other accounts are evicted.
- `runningSupplements` (`apps/api/src/garmin/supplements.ts`) holds the
  account's supplementary Garmin pass while it runs and joins a visit that
  arrives mid-pass, instead of starting a second one. An entry is removed when
  its pass settles, so the map is bounded by the accounts mid-pass; see ADR 0039.
- The model-catalog refresh handle (`apps/api/src/llm/modelCatalog.ts`) is a
  single in-flight promise that is cleared when it settles, so a page visit joins
  one refresh per instance rather than accumulating handles.

## Reply batching

`replyToUnansweredActivityComments` loads every activity comment without a
`coach_replies` row, builds one prompt listing all of them with stable ids, and
saves the returned replies by id. A comment whose id is missing from the
response is left unanswered for the next run.

The single-input reply paths (weekly note, manual activity, review comment,
coach question) keep their existing prompts. They still start a run, so a new
input supersedes an older plan refresh; the coach-question answer also runs the
reply phase so comments left waiting by a superseded run still get answered.

## UI

- A comment save adds the activity to the visit's kept list, writes the comment
  into the feed on screen, and returns at once.
- While any activity has a comment but no coach reply, the dashboard polls
  `GET /api/coaching/activities/cached` every 1.5 seconds for up to one minute
  and merges new replies into the feed on screen. The endpoint overlays the
  stored comment, reply and review state when it reads the activity rows, so a
  reply written by the reply phase shows up before the plan phase refreshes the
  feed. The
  activity card shows `Coach: thinking…` under the athlete's comment until the
  reply replaces it.
- The plan section continues to poll generation status. A superseded run never
  writes `done` or `error`; the new run owns the status row, so polling follows
  the newest run.

## Acceptance criteria

- Two comments saved while a run is active produce one superseded run and one
  current run that answers both comments.
- The current run's replies are visible before the plan refresh finishes.
- Answering a coach question also answers activity comments left waiting by a
  superseded run.
- A superseded run cannot overwrite the plan, mark the new run done or failed,
  or record its coach questions and metric estimates.
- An aborted completion is not retried by the reasoning-model fallback cascade.
- Deleting an activity still refreshes the plan. Saving a manual activity or a
  weekly note refreshes it when the coach's reply judges the input changes the
  plan, and a newer save supersedes that refresh.
- A corrupt plan is still reported once while it is read repeatedly, and the
  report set, trigger times and finished feeds stay within their documented
  bounds.
