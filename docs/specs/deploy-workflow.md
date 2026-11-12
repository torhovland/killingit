# Deploy workflow

## Goal

Deploy exactly the commit CI verified, run one deploy per environment at a time,
and keep a manual dispatch from bypassing CI.

## Scope

`.github/workflows/deploy.yml` and the deployment section of `README.md`. The
workflow build, migration and Cloud Run/Cloudflare steps themselves are
unchanged.

## Behaviour

### The deployed commit

A `workflow_run` deploy has no `github.sha` of its own that is useful: GitHub
reports the default branch's newest commit there, which may be newer than the
commit the triggering CI run tested. The workflow therefore sets one value:

```yaml
env:
  DEPLOY_SHA: ${{ github.event.workflow_run.head_sha || github.sha }}
```

`head_sha` is the commit the triggering CI run belonged to. A manual dispatch
has no `workflow_run` payload, so the expression falls back to the dispatched
commit. Every checkout (`ref:`), image tag, and Sentry release uses
`DEPLOY_SHA`, so the built tree, the pushed image, and the release it reports
cannot name different commits.

### CI gate

- A `workflow_run` deploy only proceeds when the triggering run concluded
  successfully (the existing `if` on every job is kept).
- `workflow_dispatch` must run from `main` and deploy a commit with a completed
  successful `ci.yml` run. The `verify-ci` job fails the run before any image
  is built when `GITHUB_REF` is not `refs/heads/main` or the Actions API finds
  no successful CI run for `DEPLOY_SHA` on `main`.
- The production `environment: production` approval gate is unchanged; the
  manual dispatch still pauses for approval.

### Concurrency

The jobs that touch an environment (`deploy-api-test`, `deploy-web-test`,
`deploy-api-production`, `deploy-web-production`) share a per-environment
concurrency group:

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

## Acceptance criteria

- On `workflow_run`, all checkouts, image tags, and Sentry releases use the
  triggering run's `head_sha`.
- A manual dispatch from another branch, or for a commit without a successful
  CI run on `main`, fails before building or deploying.
- Deploys to one environment never overlap, and a running deploy is never
  cancelled by a queued one.
- `scripts/deployWorkflow.test.ts` asserts these invariants. `bun run test` runs
  it, and CI's test job runs the same script suite through `test:coverage`.

## Data model and API impact

None. No application code, schema, or API route changes.
