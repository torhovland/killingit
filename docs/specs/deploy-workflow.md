# Deploy workflow

## Goal

Deploy exactly the commit CI verified, run one deploy per environment at a time,
and keep a manual dispatch from bypassing CI, without maintaining two copies of
the same deploy pipeline.

## Scope

`.github/workflows/deploy.yml`,
`.github/workflows/deploy-environment.yml` and the deployment section of
`README.md`. The workflow build, migration and Cloud Run/Cloudflare steps
themselves are unchanged.

## Behaviour

### Structure

`deploy.yml` owns the trigger, the CI gate, the two image builds and the two
environment jobs. One reusable workflow,
`.github/workflows/deploy-environment.yml`, holds the pipeline both
environments run: checkout, Google Cloud auth, migrations, Garmin sidecar
deploy, IAM binding, API deploy, web build and Pages publish, in that order.

A caller job passes everything the environment varies as inputs: the deployed
commit, the two image outputs, the Cloud Run service names, the CORS origin, the
Pages project, the web API URL and `VITE_APP_ENV`. It maps the environment's
secrets explicitly under `on.workflow_call.secrets`; no secret is inherited
implicitly. Both caller jobs keep their `if`, `needs`, per-environment
`concurrency` and job-level `permissions` (`contents: read`, `id-token: write`,
`deployments: write`). The two build-and-push jobs stay in `deploy.yml` because
they are short, and extracting them would only move the same auth and Docker
steps behind another input list.

`scripts/deployWorkflow.test.ts` parses both files and pins the invariants
below.

### The deployed commit

A `workflow_run` deploy has no `github.sha` of its own that is useful: GitHub
reports the default branch's newest commit there, which may be newer than the
commit the triggering CI run tested. The workflow therefore sets one value for
the build jobs:

```yaml
env:
  DEPLOY_SHA: ${{ github.event.workflow_run.head_sha || github.sha }}
```

A `workflow_call` workflow does not inherit the caller's top-level `env`, so each
caller also passes the same expression as the `deploy_sha` input. A manual
dispatch has no `workflow_run` payload, so the expression falls back to the
dispatched commit.

Inside the reusable workflow every checkout (`ref:`) and every Sentry release
uses `${{ inputs.deploy_sha }}`, and the API and Garmin images arrive already
tagged with it. The built tree, the pushed image and the release it reports
therefore cannot name different commits.

### CI gate

- A `workflow_run` deploy only proceeds when the triggering run concluded
  successfully (the `if` on the test caller and on every build job).
- `workflow_dispatch` must run from `main` and deploy a commit with a completed
  successful `ci.yml` run. The `verify-ci` job fails the run before any image
  is built when `GITHUB_REF` is not `refs/heads/main` or the Actions API finds
  no successful CI run for `DEPLOY_SHA` on `main`. The production caller is
  dispatched only, as before.

### Production approval

GitHub does not allow `environment:` on a job that calls a reusable workflow, so
the environment cannot sit on the caller job. Instead each caller passes the
environment name and the called job applies it:

```yaml
# deploy.yml
with:
  environment_name: production

# deploy-environment.yml
environment: ${{ inputs.environment_name }}
```

The `production` environment's protection rules therefore still gate the whole
pipeline before its first step. The test caller passes `test`; that environment
carries no protection rules. Because the pipeline is one called job, production
now pauses once instead of once for the API job and once for the web job.

### Concurrency

The two caller jobs (`deploy-test`, `deploy-production`) share a
per-environment concurrency group:

```yaml
concurrency:
  group: deploy-test # or deploy-production
  cancel-in-progress: false
```

A deploy that is already running finishes before the next one starts, so two
deploys never run database migrations against the same database at the same
time. With `cancel-in-progress: false` a queued deploy is not cancelled
mid-migration. GitHub keeps only one pending run per group, so if several
pushes queue up the newest pending deploy replaces the older pending one and
the environment still ends on the latest verified commit.

The build-and-push jobs are not serialised: they only push an image tagged with
a commit SHA, which two runs cannot conflict over.

### The Bun version

Every `oven-sh/setup-bun@v2` step in `deploy-environment.yml` passes
`bun-version-file: .bun-version`, so the migration, web-build and API steps
install the same Bun release CI verified the commit with. The API image's
`oven/bun` tags name that release too. `scripts/bunVersion.test.ts` asserts it
for every workflow file, and `bun run test` runs it.

### The Pages publish

Pinning every checkout to the deployed commit leaves the runner on a detached
HEAD, so wrangler cannot read a branch name. The reusable workflow's single
Pages step therefore passes `--branch=main` explicitly, with the environment's
project name as an input. A deployment on the project's production branch
replaces the site behind `killingit-test.hovland.co` and
`killingit.hovland.co`; a deployment on any other branch is a preview. Without
the flag, wrangler names the branch `head`, publishes a preview, and the custom
domain keeps serving the previous production deployment while every deploy job
still reports success. That is how the web sites silently stopped updating when
the deployments were pinned to a SHA.

## Acceptance criteria

- On `workflow_run`, all checkouts, image tags, and Sentry releases use the
  triggering run's `head_sha`.
- Every caller passes the deployed commit as `deploy_sha`, and the reusable
  workflow reads it instead of an inherited environment variable.
- A manual dispatch from another branch, or for a commit without a successful
  CI run on `main`, fails before building or deploying.
- The Pages publish names `main` as the branch and takes the environment's
  project as an input, so a pinned checkout cannot publish a preview in place of
  the environment's site.
- Deploys to one environment never overlap, and a running deploy is never
  cancelled by a queued one.
- The production caller selects the `production` environment, whose protection
  rules gate the whole called pipeline.
- The called workflow runs migrations, the Garmin sidecar deploy, the IAM
  binding and the API deploy before it builds and publishes the web.
- Every Bun installation in the workflows reads `.bun-version`, so the deploy
  cannot install a release other than the one CI verified.
- `scripts/deployWorkflow.test.ts` asserts these invariants, including that
  every input and secret the reusable workflow references is declared and that
  both callers pass them. `bun run test` runs it, and CI's test job runs the
  same script suite through `test:coverage`.

## Data model and API impact

None. No application code, schema, or API route changes.
