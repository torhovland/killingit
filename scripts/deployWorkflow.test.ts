import { describe, expect, it } from "bun:test";
import path from "node:path";

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  if?: string;
  needs?: string[];
  environment?: string;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  steps?: WorkflowStep[];
}

interface Workflow {
  env?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

const WORKFLOW_PATH = path.resolve(
  import.meta.dir,
  "..",
  ".github",
  "workflows",
  "deploy.yml",
);
const WORKFLOW_TEXT = await Bun.file(WORKFLOW_PATH).text();
const WORKFLOW = Bun.YAML.parse(WORKFLOW_TEXT) as Workflow;
const DEPLOY_SHA = "${{ env.DEPLOY_SHA }}";

function stepsOf(jobId: string): WorkflowStep[] {
  return WORKFLOW.jobs[jobId]?.steps ?? [];
}

function allSteps(): WorkflowStep[] {
  return Object.values(WORKFLOW.jobs).flatMap((job) => job.steps ?? []);
}

describe("deployed commit", () => {
  it("checks out the commit CI verified in every job", () => {
    expect(WORKFLOW.env?.DEPLOY_SHA).toBe(
      "${{ github.event.workflow_run.head_sha || github.sha }}",
    );

    const checkouts = allSteps().filter(
      (step) => step.uses === "actions/checkout@v5",
    );
    expect(checkouts).toHaveLength(6);
    for (const step of checkouts) {
      expect(step.with?.ref).toBe(DEPLOY_SHA);
    }
  });

  it("never falls back to the default branch's newest commit", () => {
    // The only `github.sha` in the file is the dispatch fallback inside
    // `DEPLOY_SHA`; a bare use would deploy a commit CI never tested.
    expect(WORKFLOW_TEXT.match(/\$\{\{\s*github\.sha\s*\}\}/g)).toBeNull();
  });

  it("tags both images with the deployed commit", () => {
    const imageSteps = allSteps().filter((step) =>
      step.run?.includes('echo "image='),
    );
    expect(imageSteps).toHaveLength(2);
    for (const step of imageSteps) {
      expect(step.run).toContain(DEPLOY_SHA);
    }
  });

  it("reports the deployed commit as the Sentry release", () => {
    const releases = WORKFLOW_TEXT.match(/SENTRY_RELEASE[:=][^\n]*/g) ?? [];
    expect(releases.length).toBeGreaterThan(0);
    for (const release of releases) {
      expect(release).toContain(DEPLOY_SHA);
    }
  });
});

describe("CI gate", () => {
  it("verifies a manual dispatch against CI", () => {
    const guard = stepsOf("verify-ci").find((step) =>
      step.run?.includes("gh api"),
    );
    expect(guard).toBeDefined();
    expect(guard?.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(guard?.run).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(guard?.run).toContain(
      "actions/workflows/ci.yml/runs?head_sha=${DEPLOY_SHA}&branch=main",
    );
    expect(guard?.run).toContain('select(.conclusion == "success")');
  });

  it("gates both image builds on the manual check", () => {
    for (const jobId of ["build-and-push-api", "build-and-push-garmin"]) {
      expect(WORKFLOW.jobs[jobId]?.needs).toContain("verify-ci");
    }
  });

  it("keeps the automatic deploy behind a successful CI run", () => {
    for (const jobId of [
      "build-and-push-api",
      "build-and-push-garmin",
      "deploy-api-test",
      "deploy-web-test",
    ]) {
      expect(WORKFLOW.jobs[jobId]?.if).toContain(
        "github.event.workflow_run.conclusion == 'success'",
      );
    }
  });

  it("keeps the production approval gate", () => {
    expect(WORKFLOW.jobs["deploy-api-production"]?.environment).toBe(
      "production",
    );
    expect(WORKFLOW.jobs["deploy-web-production"]?.environment).toBe(
      "production",
    );
  });
});

describe("concurrency", () => {
  it("serialises each environment without cancelling a running deploy", () => {
    const groups = Object.fromEntries(
      Object.entries(WORKFLOW.jobs).flatMap(([jobId, job]) =>
        job.concurrency ? [[jobId, job.concurrency.group]] : [],
      ),
    );
    expect(groups).toEqual({
      "deploy-api-test": "deploy-test",
      "deploy-web-test": "deploy-test",
      "deploy-api-production": "deploy-production",
      "deploy-web-production": "deploy-production",
    });

    for (const job of Object.values(WORKFLOW.jobs)) {
      if (job.concurrency) {
        expect(job.concurrency["cancel-in-progress"]).toBe(false);
      }
    }
  });
});
