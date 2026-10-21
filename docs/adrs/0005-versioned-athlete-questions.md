# ADR 0005: Versioned athlete questions

- **Status:** Accepted
- **Date:** 2026-10-20
- **Deciders:** torhovland

## Context

Onboarding and ongoing coaching rely on questions answered by the athlete. The
question set is expected to evolve: prompts get reworded, questions are added,
and questions are retired. Answers must stay interpretable when the wording that
produced them changes, and the answers will later be included in coach LLM
prompts.

Storing only the current wording would silently change the meaning of historical
answers. Storing the wording inline on each answer would duplicate content and
make the admin view awkward.

## Decision

- **Separate stable identity from immutable content.** `questions` holds the
  identity, lifecycle (`archived_at`), and `current_version`. `question_versions`
  holds append-only rows of `prompt` + `required` with a per-question version
  number and a unique `(question_id, version)` constraint.
- **Editing appends a version.** Creating a question inserts version 1. Saving an
  edit locks the question row, inserts `current_version + 1`, and updates the
  pointer. Versions are never mutated or deleted through the API.
- **Deleting archives.** `DELETE` sets `archived_at`, hiding the question from
  the active list while preserving every version. Archived questions reject new
  versions.
- **Free text only in v1.** Each version carries a prompt and a `required` flag.
  Choice/numeric/scale answer types can be added as extra version fields later
  without rewriting existing rows.
- **Expose the current version row id.** Question responses include `versionId`
  (the `question_versions.id`) alongside the version number, so a future answer
  submission can pin the exact wording the athlete saw even if an admin edits the
  question concurrently.
- **Admin-only management.** Question management requires the `admin` role
  (ADR 0006). The first account in an environment becomes admin; other accounts
  are members and receive `403` from the admin routes.

## Consequences

- **Positive:** history is preserved and audit-friendly; future answers can
  reference the exposed `versionId` and always know the exact wording shown;
  edits are visible in the data model; archiving avoids orphaning references.
- **Negative / limits:** reads need a join or second query to resolve the current
  version; every edit adds a row (intended); there is no restore or history UI
  yet; only one admin can manage questions until role management lands.
- **Follow-ups:** add answers keyed by `question_versions.id`; include the active
  question/answer set in coach prompts; add archive restore and an
  ordered/reorderable list if onboarding needs it; add admin management.

## Rejected alternatives

- **One mutable `questions` row:** simple, but silently rewrites the meaning of
  past answers and prevents audit.
- **Version only the prompt text:** `required` and future answer-type metadata
  would still drift; version the whole answer-shaping payload instead.
- **Hard delete:** destroys the wording referenced by historical answers and
  removes the audit trail.
- **Store question text on each answer:** duplicates content, makes admin edits
  inconsistent, and bloats the answers table.

## References

- `docs/specs/versioned-athlete-questions.md` — implementation spec.
- `docs/adrs/0003-garmin-activity-data-access.md` — single-operator phase.
- `AGENTS.md` — athlete profile and LLM prompt requirements.
