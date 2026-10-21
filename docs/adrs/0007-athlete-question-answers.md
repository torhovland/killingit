# ADR 0007: Athlete answers keyed by question version

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** torhovland

## Context

ADR 0005 introduced an admin-managed, versioned athlete question set but left
answer capture out of scope. Answers are needed for onboarding: the athlete
should answer the questions before seeing activities, and the answers should
remain interpretable when an admin later edits a prompt. ADR 0005 already
exposes the current `question_versions.id` specifically so an answer can pin the
wording the athlete saw.

## Decision

- **Store answers against `question_versions.id`.** A `question_answers` row
  references the user and the exact immutable version, not just the stable
  question id. The question itself is reached through the version row.
- **One response per athlete per version.** A unique
  `(user_id, question_version_id)` constraint makes submission an upsert, so
  resubmitting updates the athlete's answer or skip instead of duplicating it.
- **The current version is the one that counts.** A submission is rejected unless
  the `versionId` is the current version of an active question. Completion is
  computed from responses to current versions, so editing a prompt appends a new
  version and asks the athlete that question again. This avoids treating an
  answer to old wording as an answer to new wording.
- **Batch submission.** The athlete form submits every active question in one
  request, which keeps a single onboarding save atomic from the client's point of
  view and returns the refreshed question list and completion flag.
- **Every active question is presented once, and optional ones can be skipped.**
  The API reports `complete` as "every active question has an answer to its
  current version, or is optional and marked skipped". A null answer records an
  explicit skip; skipping a required question is rejected. The web dashboard
  renders the question form and does not mount the coaching surface (or fetch
  activities) until `complete` is true. This means a set containing only optional
  questions is still presented, while blank optional answers never force text.
- **Athlete routes are authenticated, not admin-only.** Every signed-in user may
  read their own question list and write their own answers; admin routes remain
  the only way to manage questions.
- **Answers are retained.** Archived questions and superseded versions keep
  their answers. The first version never mutates, so historical answers remain
  interpretable and available for future coach prompts.

## Consequences

- **Positive:** answers are tied to the exact wording shown, edits naturally
  re-prompt athletes, resubmission is idempotent, and the UI cannot leak
  activities before onboarding.
- **Negative / limits:** an admin typo fix re-asks the question; completion is a
  read-time calculation over the active set rather than a stored flag; skips and
  answers share one table.
- **Follow-ups:** include current question/answer pairs in coach prompts; add a
  version-history view of earlier answers; surface skips distinctly in that
  history.

## Rejected alternatives

- **One mutable answer per question:** simpler, but an admin edit silently
  changes what the athlete's stored answer is assumed to mean and prevents
  version-aligned audit.
- **Store the prompt text on the answer:** duplicates content and lets the
  answer drift from the immutable version.
- **Gate only on required questions:** leaves a set containing only optional
  questions unanswerable and keeps optional questions out of onboarding.
- **Treat an unanswered optional question as blocking forever with no skip:** traps
  athletes on a question they are allowed to leave blank.
- **Store a single "onboarding complete" boolean on the user:** cannot express
  newly added or edited questions and hides which required questions are still
  unanswered.
- **Block the coaching API server-side:** the requirement is about the athlete's
  presentation and navigation; enforcing it in the UI avoids coupling the
  coaching endpoint to onboarding state. The API still only exposes the
  signed-in user's own answers.

## References

- `docs/specs/athlete-question-answers.md` — implementation spec.
- `docs/adrs/0005-versioned-athlete-questions.md` — versioned question set.
- `docs/adrs/0006-admin-roles.md` — authenticated accounts and roles.
- `AGENTS.md` — athlete profile and quality gates.
