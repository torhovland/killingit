# Spec: Test-file organisation

- **Status:** Accepted (implemented)
- **Date:** 2026-11-15
- **Related:** issue #275, issue #543, `docs/specs/test-coverage.md`,
  `docs/specs/plan-generation-modules.md`,
  `docs/specs/web-interaction-tests.md`.

## Goal

Keep a test file as small as the production module it covers, so a reviewer can
see which behaviour belongs where instead of scrolling a 2,000-line suite. Test
setup that more than one file needs lives in a test fixture, not in a copy of
`createApp` or a duplicated plan.

## Scope

### In scope

1. An API route test file covers one route module or one route concern. The
   coaching routes under `apps/api/src/routes/coaching/` are tested next to
   their production modules: `feed.test.ts`, `comments.test.ts`,
   `manualActivities.test.ts`, `weeklyNotes.test.ts`, `reviews.test.ts`,
   `coachQuestions.test.ts` and `pathParams.test.ts`.
2. The plan route tests are split into `planRead.test.ts` (reading a plan and
   its pending/stale state), `planGeneration.test.ts` (starting and settling a
   run) and `planExport.test.ts` (the ZWO download).
3. `apps/api/src/testFixtures/app.ts` owns the DB-free route app:
   `makeTestApp(options)`, `authenticatedRequest`, the in-memory plan and
   generation stores, and the empty answer, survey and coaching-input fixtures.
   A suite replaces only the dependency it exercises and extends this builder
   rather than copying it.
4. `apps/api/src/testFixtures/planRoute.ts` owns the plan-route-only helpers:
   the combined forecast set and waiting for a background generation to settle.
   Plan generation fixtures stay in `testFixtures/generationHarness.ts`.
5. A web component test is split by the component's concern.
   `CoachPlanView` has separate day, levels, calories, weather, refresh,
   training, workout-file and threshold files. The one plan fixture and the
   heading bullet live in `apps/web/src/testFixtures/plan.ts`.
6. Knip excludes each package's `src/testFixtures/` directory, exactly as it
   already excluded the API directory, so a helper exported only for tests is
   not reported as an unused production export.
7. A web suite that registers a process-global `mock.module` stub calls
   `mock.restore()` in `afterAll`, because Bun's module registry is shared by
   every file in the test process. `apps/web/src/mockIsolation.test.ts` fails
   when any web test file mocks a module without that restore.
8. The database-backed integration suite is split the same way, one file per
   store under `apps/api/integration/`: `migrations`, `dbUserStore`,
   `dbPlanStore`, `dbPlanGenerationStore`, `questionStores`, `metricsStores`,
   `activityStore`, `manualActivityWrites`, `coachQuestionConstraints`,
   `foodEntryStore` and `athleteEvents`. `integration/setup.ts` registers the
   migration, truncation and close hooks every file needs, so the split keeps a
   single migration run for the whole process and truncates before every test.
   `integration/helpers.ts` owns the SQLSTATE and threshold readers that more
   than one suite uses, and `integration/planFixture.ts` keeps the one plan.

### Out of scope

- Splitting a file that has no natural seam. `apps/api/src/plans/generate.test.ts`
  tests one function across 204 lines, so it stays whole.
- Changing a test, its assertions, its title or its skip state. The split moves
  test bodies verbatim.
- Moving fixtures that only one test file uses.

## Acceptance criteria

- Every test that ran before the split still runs, with the same title and the
  same body; only imports and file placement change.
- The integration split keeps that rule too: `integration/setup.ts` migrates
  once for the run, truncates before every test, and closes the pool after the
  last file.
- A route test builds its app through `testFixtures/app.ts` instead of a local
  `makeApp`.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
  `bun run test:coverage` and `bun run check:unused` pass.

## Data model and API impact

None. This is test-file structure and test fixtures only.
