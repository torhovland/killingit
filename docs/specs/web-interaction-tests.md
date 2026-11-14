# Spec: Web interaction tests

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** issue #306, `docs/specs/modal-dialog.md`,
  `docs/specs/web-api-resource-hook.md`, `docs/specs/e2e-tests.md`,
  `docs/specs/test-coverage.md`.

## Goal

Let the web unit suite mount a component, run its effects, click it, type into
it and observe the result, so the async state layer is covered below the
Playwright journey suite. Before this, every web test rendered static HTML with
`renderToStaticMarkup`, which runs no effect and accepts no input: fetch hooks,
save queues, polling and dialogs were only reachable through the e2e suite.

## Scope

### In scope

1. `@testing-library/react`, `@testing-library/user-event` and `happy-dom`
   (with `@happy-dom/global-registrator`) as `apps/web` dev dependencies.
2. `apps/web/bunfig.toml` preloads `src/testSetup.ts`, which registers the DOM
   globals before any test module is imported and sets
   `IS_REACT_ACT_ENVIRONMENT` so React treats Testing Library's wrapped updates
   as `act`.
3. Existing `renderToStaticMarkup` tests whose subject is behaviour rather than
   markup are converted to real renders and interactions:
   `useCommentForm`, `PlanRegenerationButtons`, `useActivityFeed`,
   `DeleteAccountSection` and the calendar entry dialog.
4. Interaction tests for the `Modal` primitive: focus moves into the dialog,
   Tab and Shift+Tab wrap inside it, Escape and a backdrop click close it, a
   panel click does not, and closing restores focus to the trigger.
5. Effect and race tests for `useApiResource`, `useApiResources` and
   `useAbortableRequest`: the initial load, the loading and error state, the
   header spinner source, `reload`, a `null` path and a signed-out session
   skipping the request, a superseded path whose late response is dropped, and
   an unmount that aborts the in-flight request without surfacing an error.
6. A conversion rule for new tests: render the component and query it by role
   or test id; use `renderToStaticMarkup` only for assertions about the exact
   server-rendered markup, such as a class list or attribute order.

### Out of scope

- Covering every remaining untested component. The 40 file names in the issue
  are the backlog; this change installs the harness and proves it on the
  highest-risk layer.
- Removing the Playwright journeys. They still own real-browser behaviour such
  as navigation, the PWA shell and the Auth0 redirect.
- A test for browser layout or CSS. Happy DOM has no layout engine.

## Design

`bunfig.toml` is the only per-package test configuration:

```toml
[test]
preload = ["./src/testSetup.ts"]
```

The preload registers happy-dom once per `bun test` process. Testing Library
binds `screen` to `document.body` at import time, so registration must happen
before the test files load; importing the registrar from each test is too late.
Testing Library's automatic cleanup runs because Bun exposes a global
`afterEach`.

Requests are replaced by stubbing `globalThis.fetch`, matching the existing
`fetchJson` and `fetchAuthed` tests, rather than by mocking `requestParsed`.
That keeps the test on the real `requestParsed` validation and abort path. A
hook that reads `useAuth` is exercised through a process-global `./auth` mock,
the same pattern `GarminSection.test.tsx` already uses, with a mutable session
so a test can mount signed out.

## Acceptance criteria

- A component test can click, type and wait for an effect's result.
- Escape, backdrop close, focus trap and focus restore are unit tested.
- A superseded and an unmounted `useApiResource` request never commit state and
  never surface an error.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
  `bun run test:coverage` and `bun run check:unused` pass.

## Data model and API impact

None. This is the web test harness and its tests only.
