# Modal dialog primitive

- **Status:** Accepted (implemented)
- **Date:** 2026-11-12
- **Related:** issues #172 and #328, `docs/specs/web-component-library.md`,
  `docs/specs/calendar-page.md`, `docs/specs/account-deletion.md`,
  `docs/specs/e2e-tests.md`, ADR 0027.

## Goal

Give every modal dialog the keyboard behaviour a modal needs. A keyboard user
must not be able to Tab into the page behind an open dialog, Escape must close
it, and the control that opened it must get focus back when it closes. Every
dialog — the calendar entry dialog, the delete-account confirmation and the
destructive confirmations for activities, manual activities and athlete
questions — uses the same primitive so the behaviour cannot drift apart.

## Scope

### In scope

1. A `Modal` primitive in `apps/web/src/components/Modal.tsx` that renders the
   backdrop and the dialog panel.
2. `role="dialog"`, `aria-modal="true"`, and a required `labelledBy` id plus an
   optional `describedBy` id.
3. Focus moves into the dialog on open: the first focusable element, or the
   panel itself when there is none.
4. Tab and Shift+Tab wrap inside the dialog instead of reaching the page
   behind it.
5. Escape closes the dialog, and a backdrop click closes it the same way. A
   caller can make both a no-op, which is how the delete dialog stays open
   while the deletion request runs.
6. Closing restores focus to the element that was focused when the dialog
   opened, unless that element has since been removed.
7. `CalendarEntryDialog` and `DeleteAccountSectionView` render through `Modal`
   and stop carrying their own overlay, Escape handler and `autoFocus`.
8. A `ConfirmDialog` primitive in `apps/web/src/components/ConfirmDialog.tsx`
   builds on `Modal` for destructive confirmations: a title, a consequence
   description, a Cancel button and one labelled destructive action. Cancel is
   rendered first so opening the dialog focuses the safe action, not the one
   that deletes. It owns the busy state, the failure message and the rule that
   Escape, the backdrop and Cancel wait while the action runs.
9. `ActivityCard`, `QuestionRow` and the Activities page's manual-activity list
   confirm through `ConfirmDialog` instead of `window.confirm`. The manual
   activity hook exposes the pending deletion and its confirm/cancel handlers,
   because a hook cannot render the dialog; `ActivitiesPage` renders the one
   dialog for the list.
10. The Tab-wrapping decision lives in a pure `trappedFocusIndex` helper, and
    the mounted dialog's focus capture, wrap-around, Escape, backdrop close and
    focus restore are covered by Testing Library interaction tests; the
    Playwright suite still covers the same keys through the real calendar,
    delete-account and question-archive flows. See
    `docs/specs/web-interaction-tests.md`.
11. `no-restricted-syntax` rejects a native `confirm()` in the web app, so a
    new deletion cannot bypass the primitive. See
    `docs/specs/accessibility-lint.md`.

### Out of scope

- Nested or stacked dialogs. There is one dialog at a time in the app.
- A dialog that is mounted permanently and shown with an `open` prop. Callers
  mount `Modal` (or `ConfirmDialog`) only while it is open, which makes focus
  capture and restore one mount/unmount pair.
- Making the page behind the dialog `inert` or hiding it from assistive
  technology beyond `aria-modal`. The focus trap covers keyboard interaction.
- A dialog service, portal or routing layer.

## Design

`Modal` owns the fixed inset backdrop, the card panel, the Escape and Tab
keydown listener, and focus capture and restore. Callers own the content and
the accessible names:

```tsx
<Modal
  labelledBy="calendar-entry-title"
  onClose={onClose}
  className="max-h-full max-w-2xl overflow-y-auto"
  testId="calendar-entry-dialog"
>
  <h3 id="calendar-entry-title">…</h3>…
</Modal>
```

`ConfirmDialog` is the destructive variant, so a confirmation has one shape:

```tsx
<ConfirmDialog
  title="Delete this activity?"
  description="It disappears from your coaching view; its comment and coach reply are removed and the plan is revised."
  confirmLabel="Delete"
  busyLabel="Deleting…"
  busy={deleting}
  error={deleteError}
  onConfirm={() => void remove()}
  onCancel={() => setConfirming(false)}
/>
```

The safe action comes first in the DOM, so `Modal`'s first-focus rule lands on
Cancel; the destructive button keeps its own text as its accessible name. The
dialog's heading and description ids come from `useId`, so two call sites never
repeat ids. `busy` disables both buttons and makes Escape and the backdrop
no-ops, and a failed action shows its error inside the same dialog instead of
closing it and moving the failure to the page.

The event listener is attached once per mount and reads the latest `onClose`
through a ref, so a caller that passes an inline callback does not re-run the
effect and lose the captured trigger. A disabled trigger stays where it is:
the listeners are document-level, so an Escape that the caller ignores simply
leaves the dialog open.

`trappedFocusIndex(count, activeIndex, shiftKey)` returns the index a Tab press
should move to, or `null` when the browser's own move already stays inside the
dialog. `activeIndex` is `-1` when focus is on the panel itself or has escaped.

## Acceptance criteria

- No focus can leave an open dialog with Tab or Shift+Tab.
- Escape closes both dialogs, and the delete dialog ignores it while the
  deletion request runs.
- Focus returns to the control that opened the dialog.
- Both dialogs carry `aria-labelledby` pointing at their heading, and the
  delete dialog also names its warning paragraph with `aria-describedby`.
- A destructive confirmation opens with focus on Cancel, names its action,
  blocks every close path while it runs, and shows a failure inside itself.
- No web source calls the native `confirm()`.
- `bun run typecheck`, `bun run lint`, `bun run format` and `bun run test`
  pass, and `bun run test:e2e` passes against the docker-compose database.

## Data model and API impact

None. This is a frontend-only change; no route, schema or prompt changes.
