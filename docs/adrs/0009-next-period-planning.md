# ADR 0009: Plan the next week and block before the rollover

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** torhovland
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/dashboard-layout.md`

## Context

The dashboard shows today and, after 18:00, tomorrow. A week plan was stored
only for the week containing today. On Sunday evening tomorrow is Monday of the
next week, so tomorrow's session lived outside the stored week and was produced
by the daily prompt without a weekly plan for its own week. The same problem
existed at a block boundary: tomorrow could belong to the next block while the
current block was the only one stored.

The athlete should be able to see tomorrow as part of a real week and block,
without the current week or block being rewritten before it ends.

## Decision

- Store an optional `next_week` and `next_block` on `coach_plans` alongside
  `tomorrow`.
- Only after 18:00, when tomorrow falls outside the current week or block, call
  the weekly and/or block prompts for the period that contains tomorrow. The
  current week and block are left untouched.
- Generate tomorrow's day plan against that target week, then mirror the day
  into the matching week session so the Day and Week tabs cannot disagree.
- Promote a stored next week or block to the current slot when today enters it.
  Capture the ended period's review first, then drop the finished one.
- `GET /api/coaching/plan` returns the promoted view for display but reports
  pending flags from the stored plan, so the first visit after a rollover still
  persists the promotion and captures reviews.

## Alternatives considered

- **Keep a rolling array of weeks and blocks.** More general, but more invasive
  for every consumer and unnecessary while the app only needs today, tomorrow,
  and their parent periods. Two named slots make the current/next distinction
  explicit.
- **Generate the next week lazily on Monday only.** Simplest, but it leaves
  Sunday evening's tomorrow session detached from any week, which is the
  problem this ADR fixes.
- **Rewrite the current week to include next Monday.** Violates the requirement
  that the current week stays stable until it ends.

## Consequences

- Two nullable JSON columns and a migration. Existing rows read as null, and
  plans stored before this change still parse because the shared schema
  defaults the new fields to null.
- Sunday-evening generation can cost up to three extra completions (next block,
  next week, next day). The next period is reused on subsequent visits.
- A mid-week block boundary still re-plans the remainder of the current week
  under the new block, because tomorrow's session cannot be coherent with a
  block that no longer contains it.
- The Week and Block tabs show one or two sections depending on whether a next
  period has been planned.
