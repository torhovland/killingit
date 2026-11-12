# Spec: Account deletion

- **Status:** Accepted (implemented)
- **Date:** 2026-11-03
- **Related:** ADR 0006, `docs/specs/user-time-zone.md`.

## Goal

Let an athlete permanently delete their account and every piece of data the app
holds about them, without leaving orphaned plans, activities, or coach history
behind.

## Scope

### In scope

1. A "Delete account" section at the bottom of the Settings page.
2. A red-outlined button with a danger icon that opens a confirmation modal.
3. A modal warning that all associated data will be deleted permanently.
4. `DELETE /api/me` deletes the account row and all rows owned by it.
5. A successful deletion signs the athlete out and returns them to the sign-in
   screen.

### Out of scope

- Deleting the identity at the auth provider (Auth0). The app removes its own
  data; a later sign-in creates a new, empty account.
- A grace period, export, or undo.

## Behaviour

- The Settings section is always visible at the bottom of the page, regardless
  of whether the other settings loaded successfully.
- The modal uses the shared `Modal` primitive: it can be dismissed with Cancel,
  Escape, or by clicking the backdrop, keeps Tab and Shift+Tab inside it, and
  returns focus to the Delete account button. Every dismissal is ignored while
  the deletion request is running.
- A failed deletion keeps the modal open and shows the error inside it.
- After the API confirms deletion, the app calls the auth provider's logout so
  the still-valid token cannot recreate the account immediately.

## Data model / API

- No schema change. Every user-owned table references `users.id` with
  `ON DELETE CASCADE`, so deleting the `users` row removes the account and all
  of its plans, activities, metrics, settings, credentials, analyses, replies,
  reviews, questions, and LLM call logs in one statement.
- `UserStore.deleteUser(sub)` performs the delete; an unknown subject is a
  no-op.
- `DELETE /api/me` requires auth and returns `{ "deleted": true }`.

## Testing

- API tests cover the unauthenticated rejection and that the signed-in subject
  is passed to `deleteUser`.
- Web tests cover the button, its danger styling and icon, the confirmation
  modal, its accessible name and description, the warning, the in-flight
  disabled state, and an error inside the modal.
- The Playwright suite covers Escape, the focus trap and focus restore for the
  confirmation modal.
