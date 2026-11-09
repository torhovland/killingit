# Spec: Shared comment form state machine

- **Status:** Accepted (implemented)
- **Date:** 2026-11-09
- **Related:** `docs/specs/coach-feedback-and-program-review.md`,
  `docs/specs/period-reviews.md`, `docs/specs/web-coaching-hooks.md`

## Goal

`ActivityCard` and `PeriodReviewCard` each implement the same athlete-comment
state machine: the draft text, saving, the saved comment and coach reply,
editing, cancelling, dismissing with "No comment", and the error shown when a
save fails. The two copies had already drifted in their error sentences. Keep
one implementation so a fix reaches both cards.

## Scope

### In scope

- A `useCommentForm` hook that owns:
  - the draft comment and its setter;
  - the saved comment and reply, falling back to the values stored on the
    activity or review;
  - submitting, editing, cancelling an edit, dismissing with no comment;
  - `submitting`, `dismissing`, `editing`, and `error` state.
- A `CommentSection` presentational component that renders the saved comment,
  the `Edit comment` action, an optional reply slot, and the comment form. Test
  ids are derived from a per-card prefix (`activity`, `period-review`) so the
  existing markup contract is unchanged.
- Both cards consume the hook and the component. Each card supplies only its
  own labels, textarea id, test-id prefix, submit payload, and dismiss error
  sentence.

### Out of scope

- The API routes, payloads, and the data hooks (`useActivityFeed`,
  `useCoachReviews`) that perform the requests.
- The weekly-note form, which has a different saved/load model.
- Any visible behaviour or markup change.

## Target structure

- `apps/web/src/useCommentForm.ts` — the state machine.
- `apps/web/src/CommentSection.tsx` — the shared comment display and form.
- `apps/web/src/ActivityCard.tsx` and `apps/web/src/PeriodReviewCard.tsx` —
  consume the shared pieces and keep only their card-specific rendering.

## Acceptance criteria

1. Both cards use `useCommentForm` and `CommentSection`.
2. Editing, cancelling, dismissing, submit labels, and error handling behave as
   before, and the existing card tests pass unchanged.
3. The duplicated handler and form blocks are gone from both cards.
4. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.
