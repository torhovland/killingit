# ADR 0014: Latest input wins for coach runs

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** torhovland
- **Related:** `docs/specs/coach-run-cancellation.md`,
  `docs/specs/coach-reply-context.md`, `docs/specs/coach-plan-lifecycle.md`,
  ADR 0004 (OpenRouter integration), ADR 0013 (one prompt for plan updates)

## Context

Saving a comment generated a reply in the request and then started a plan
generation. A second save during that generation was dropped by
`plan_generations.begin`; the browser sometimes queued one follow-up plan run.
The result was late, duplicated work and a plan generated from context that had
already changed. There was no run identity on the generation row, so an older
run could still save its plan or mark the newer run done.

## Decision

- Introduce a per-user coach run. The newest run always claims the generation
  row.
- Add `plan_generations.run_id`. Every status write and the plan save are
  fenced by it.
- Abort the previous run's provider requests in the same process when a new run
  starts. Aborting is best-effort because OpenRouter has no non-streaming
  cancel endpoint.
- Answer all unanswered activity comments in one batched completion at the
  start of the run, then run the plan refresh in the same run.
- Store replies before the plan phase so they are visible quickly.
- Load the activity feed's cached replies on the dashboard while a reply is
  pending.

## Alternatives considered

- **Let the old run finish and ignore its result.** Rejected: the old run still
  writes the plan, status, questions and metric estimates unless every write is
  fenced. If every write is fenced, aborting is a cheap addition that also stops
  waiting and may stop provider work.
- **One prompt that returns replies and the plan together.** Rejected for the
  fast path: the athlete would wait for the whole plan refresh before seeing a
  reply. The plan prompt can carry replies later if the extra completion becomes
  the bottleneck.
- **A server-side queue of pending runs.** Rejected: the newest input makes the
  queued run's context stale before it starts. Latest-wins is simpler and uses
  less model time.
- **Generating each reply separately.** Rejected: two pending comments would
  cost two completions and arrive separately.

## Consequences

- A rapid sequence of comments costs one reply completion (for all unanswered
  comments) and one plan generation, not one of each per comment.
- A superseded run stops at its next fence. Prompt-log rows that were already
  written stay readable but are not marked as plan failures.
- The generation status now carries a run id, and clients can distinguish a
  newer run from a stale `done` or `error`.
- The dashboard polls the cached activity feed while replies are pending, which
  also recovers replies from an earlier run that was superseded before it could
  store them.
- The plan save is now a short transaction that locks the user's generation row.
  The extra query is negligible compared with a plan completion.
