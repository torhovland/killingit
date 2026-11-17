# Spec: Build job in CI

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Issue:** #342
- **Related:** `docs/specs/deploy-workflow.md`, `docs/specs/garmin-sidecar-checks.md`,
  `docs/specs/garmin-sidecar-modules.md`, `docs/specs/test-coverage.md`,
  `docs/specs/e2e-tests.md`, issue #343, ADR 0001, ADR 0003.

## Goal

`ci.yml` typechecked, linted, formatted and tested the tree, but never built
anything: no `vite build`, no API image, no sidecar image. A broken production
bundle or a stale `COPY` in a Dockerfile therefore passed CI and failed the
deploy workflow after merge. CI must prove the artifacts the deploy builds,
without publishing them.

## Scope

### In scope

1. A `build` job in `.github/workflows/ci.yml` that checks out the repository,
   runs the shared `.github/actions/setup-bun-install` action (the pinned Bun
   release plus `bun install --frozen-lockfile`), then `bun run build` and a
   `docker build` for `apps/api/Dockerfile` and for
   `services/garmin/Dockerfile`.
2. The API image is built with the deploy's context (`.`) and the same
   Dockerfile, and the sidecar's with context `services/garmin`, so the gate and
   the deploy cannot diverge over what they build.
3. After the sidecar image builds, a one-shot
   `docker run --rm killingit-garmin:ci python -c "import app"` imports the app
   inside the image. The Dockerfile lists the runtime modules by name, so a
   module `app.py` imports but the list forgets otherwise fails only on its
   first request.
4. Build args and the Sentry auth token stay unset, so the API Dockerfile's
   source-map injection and upload are skipped. Nothing is pushed and no
   registry is logged in to.
5. The job runs on `ubuntu-latest`, the same `linux/amd64` runner the deploy's
   image builds use, so neither image needs qemu.
6. A failing step fails the job: no `continue-on-error`, no `if: always()`
   escape hatch around the builds or the import.
7. `scripts/ciWorkflow.test.ts` pins the job's commands and their relation to
   the deploy workflow; `bun run test` and CI's test job run it.

### Out of scope

- Pushing images, authenticating to Artifact Registry, or deploying anything.
  The deploy workflow owns that (`docs/specs/deploy-workflow.md`).
- Uploading source maps to Sentry. A plain build has no token, and the deploy
  uploads the maps for the release it deploys.
- Running the servers. The one-shot import proves the sidecar image's modules
  resolve; a Cloud Run revision still proves they serve.
- The sidecar's Python checks and the API's unit tests, which keep their own
  jobs.
- The web app's deploy-time `VITE_APP_ENV` override. The job builds with the
  default (`Production`), because it gates the bundle rather than a
  deployment.

## Behaviour

```yaml
build:
  name: Build
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v5
    - uses: ./.github/actions/setup-bun-install
    - run: bun run build
    - run: docker build --file apps/api/Dockerfile --tag killingit-api:ci .
    - run: docker build --file services/garmin/Dockerfile --tag killingit-garmin:ci services/garmin
    - run: docker run --rm killingit-garmin:ci python -c "import app"
```

The checkout stays in the job. A local `./.github/actions/...` path is resolved
from the workspace, which is empty until `actions/checkout` runs, so a composite
action that checked the repository out itself could never be loaded
(actions/runner#646). The action owns the setup-bun step, its `.bun-version`
input and the frozen install; the eight CI jobs that install dependencies differ
only in the command they run afterwards.

`bun run build` is the root `bun run --filter '*' build`, so it runs every
workspace's own `build` script: the web app's `tsc --noEmit && vite build` (the
real production bundle, not just a typecheck), and the API's and shared
package's typechecks. `tools/benchmark` has no `build` script and is skipped by
the filter.

The API image build additionally proves the frozen workspace install inside the
image: the Dockerfile copies every workspace manifest the lockfile lists, and
`bun install --frozen-lockfile` fails if one is missing.

The Garmin image's `COPY` hard-lists the runtime modules (`app.py` and the
concerns it imports), while the tests, `support.py` and `contract_fixtures.py`
deliberately stay out (ADR 0058 and `docs/specs/garmin-sidecar-modules.md`). A
new module that `app.py` imports but the list forgets therefore builds green
and fails on the first request. The import step runs the built tag once as the
image's unprivileged `sidecar` user, so a missing module fails the job before
merge. It is deliberately not a `COPY` wildcard: a pattern would pull the test
modules and fixtures into the image.

### The Bun version

`.bun-version` names the one Bun release the repository uses. The eight CI jobs
that install dependencies call `.github/actions/setup-bun-install`, whose
`oven-sh/setup-bun@v2` step passes `bun-version-file: .bun-version`, so
typecheck, lint, format, unused, build, test, integration and outdated install
the same release. The sign-off job calls setup-bun directly because it skips the
install, `deploy-environment.yml` keeps its own step, and the e2e job cannot use
the action (see `docs/specs/e2e-tests.md`), so its shell step reads the same
file. The API Dockerfile's two `oven/bun` image tags name the same release.

`scripts/bunVersion.test.ts` fails when a `setup-bun` step in a workflow or in
the composite action repeats a literal `bun-version`, when either hard-codes a
`bun-v<version>` download URL, when the e2e step stops reading `.bun-version`,
or when a Dockerfile tag drifts. `bun run test` and CI's test job run it, so the
pin cannot float again.

## The API's production bundle

`bun run build` does **not** bundle the API: its `build` script is a typecheck,
and the production bundle is `bun build ./src/server.ts` run inside
`apps/api/Dockerfile`. The build job does not copy that command into the API's
`build` script, because the Docker build is the stronger gate and a local copy
would only look like coverage:

- The bundling command only means something against the file set the Dockerfile
  copies. A source file the Dockerfile forgets to `COPY` passes a local
  `bun build` on the full checkout and fails inside the image. The image build
  is the case that catches it.
- Running the same command a second time on the full checkout adds no failure
  mode the image build does not already exercise, and the two copies of the
  command could drift.

CI therefore runs the bundling command exactly where the deploy runs it.

## Acceptance criteria

- A broken `vite build`, a broken API bundling step, or a Dockerfile that no
  longer installs from the lockfile fails CI before merge.
- A sidecar module that `app.py` imports but the Dockerfile's `COPY` omits fails
  the job: the built image is imported once (`import app`) right after it is
  built.
- The job builds the same Dockerfile and context pairs as
  `deploy.yml`'s `docker/build-push-action` steps.
- The job never pushes, never logs in to a registry, and never receives a
  secret or a Sentry build arg; the import step is covered by the same
  assertions.
- Every Bun installation in `ci.yml`,
  `.github/actions/setup-bun-install/action.yml`, `deploy-environment.yml` and
  `apps/api/Dockerfile` names the release in `.bun-version`;
  `scripts/bunVersion.test.ts` fails on a literal or floating version.
- `scripts/ciWorkflow.test.ts` asserts these properties, including that the
  root `build` command reaches a real `vite build`, that the sidecar import runs
  immediately after the build that creates its tag, that every job running the
  frozen install uses the shared action (e2e excepted), and that no step can opt
  out of failing.

## Data model and API impact

None. No application code, schema, route or migration changes.
