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
  uses?: string;
  with?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  steps?: WorkflowStep[];
}

interface Workflow {
  env?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

interface WorkflowCall {
  inputs?: Record<string, { required?: boolean; type?: string }>;
  secrets?: Record<string, { required?: boolean }>;
}

interface ReusableWorkflow {
  on?: { workflow_call?: WorkflowCall };
  jobs: Record<string, WorkflowJob>;
}

const ROOT = path.resolve(import.meta.dir, "..");
const WORKFLOWS_DIR = path.join(ROOT, ".github", "workflows");
const DEPLOY_PATH = path.join(WORKFLOWS_DIR, "deploy.yml");
const ENVIRONMENT_PATH = path.join(WORKFLOWS_DIR, "deploy-environment.yml");

const DEPLOY_TEXT = await Bun.file(DEPLOY_PATH).text();
const ENVIRONMENT_TEXT = await Bun.file(ENVIRONMENT_PATH).text();
const DEPLOY = Bun.YAML.parse(DEPLOY_TEXT) as Workflow;
const ENVIRONMENT = Bun.YAML.parse(ENVIRONMENT_TEXT) as ReusableWorkflow;

const ENVIRONMENT_WORKFLOW = "./.github/workflows/deploy-environment.yml";
const DEPLOY_SHA = "${{ env.DEPLOY_SHA }}";
const DEPLOY_SHA_INPUT = "${{ inputs.deploy_sha }}";
const DEPLOY_SHA_EXPRESSION =
  "${{ github.event.workflow_run.head_sha || github.sha }}";

function stepsOf(workflow: Workflow, jobId: string): WorkflowStep[] {
  return workflow.jobs[jobId]?.steps ?? [];
}

function allSteps(workflow: Workflow): WorkflowStep[] {
  return Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
}

/** The jobs in `deploy.yml` that call the reusable environment workflow. */
function callerJobs(): [string, WorkflowJob][] {
  return Object.entries(DEPLOY.jobs).filter(
    ([, job]) => job.uses === ENVIRONMENT_WORKFLOW,
  );
}

/** The Cloudflare Pages publish command the reusable workflow runs. */
function pagesPublishCommand(): string | undefined {
  return allSteps(ENVIRONMENT)
    .map((step) => step.with?.command)
    .find(
      (command): command is string =>
        typeof command === "string" && command.startsWith("pages deploy"),
    );
}

/** Every `${{ inputs.<name> }}` and `${{ secrets.<name> }}` reference. */
function references(text: string, context: "inputs" | "secrets"): string[] {
  return [
    ...text.matchAll(
      new RegExp(`\\$\\{\\{\\s*${context}\\.([A-Za-z0-9_]+)`, "g"),
    ),
  ].map((match) => match[1] ?? "");
}

function stepIndex(workflow: Workflow, namePrefix: string): number {
  return allSteps(workflow).findIndex((step) =>
    step.name?.startsWith(namePrefix),
  );
}

describe("deployed commit", () => {
  it("checks out the commit CI verified in every job", () => {
    expect(DEPLOY.env?.DEPLOY_SHA).toBe(DEPLOY_SHA_EXPRESSION);

    const deployCheckouts = allSteps(DEPLOY).filter(
      (step) => step.uses === "actions/checkout@v5",
    );
    expect(deployCheckouts).toHaveLength(2);
    for (const step of deployCheckouts) {
      expect(step.with?.ref).toBe(DEPLOY_SHA);
    }

    // The called workflow cannot see the caller's `env`, so its one checkout
    // reads the commit from the input the callers pass.
    const environmentCheckouts = allSteps(ENVIRONMENT).filter(
      (step) => step.uses === "actions/checkout@v5",
    );
    expect(environmentCheckouts).toHaveLength(1);
    for (const step of environmentCheckouts) {
      expect(step.with?.ref).toBe(DEPLOY_SHA_INPUT);
    }
  });

  it("passes the verified commit into the reusable workflow", () => {
    const callers = callerJobs();
    expect(callers.map(([jobId]) => jobId)).toEqual([
      "deploy-test",
      "deploy-production",
    ]);
    for (const [, job] of callers) {
      expect(job.with?.deploy_sha).toBe(DEPLOY_SHA_EXPRESSION);
    }
  });

  it("never falls back to the default branch's newest commit", () => {
    // The only `github.sha` occurrences are the dispatch fallback inside
    // `DEPLOY_SHA` and its two input mappings; a bare use would deploy a
    // commit CI never tested.
    const withoutFallback = (text: string): string =>
      text.replaceAll(DEPLOY_SHA_EXPRESSION, "");
    const bareSha = /\$\{\{\s*github\.sha\s*\}\}/;
    expect(withoutFallback(DEPLOY_TEXT)).not.toMatch(bareSha);
    expect(withoutFallback(ENVIRONMENT_TEXT)).not.toMatch(bareSha);
  });

  it("tags both images with the deployed commit", () => {
    const imageSteps = allSteps(DEPLOY).filter((step) =>
      step.run?.includes('echo "image='),
    );
    expect(imageSteps).toHaveLength(2);
    for (const step of imageSteps) {
      expect(step.run).toContain(DEPLOY_SHA);
    }
  });

  it("reports the deployed commit as the Sentry release", () => {
    const deployReleases = DEPLOY_TEXT.match(/SENTRY_RELEASE[:=][^\n]*/g) ?? [];
    expect(deployReleases.length).toBeGreaterThan(0);
    for (const release of deployReleases) {
      expect(release).toContain(DEPLOY_SHA);
    }

    const environmentReleases =
      ENVIRONMENT_TEXT.match(/SENTRY_RELEASE[:=][^\n]*/g) ?? [];
    expect(environmentReleases.length).toBeGreaterThan(0);
    for (const release of environmentReleases) {
      expect(release).toContain(DEPLOY_SHA_INPUT);
    }
  });
});

describe("web publish", () => {
  it("names the production branch instead of letting wrangler infer one", () => {
    // Pinning the checkout to the deployed commit detaches HEAD, so wrangler
    // cannot read a branch and calls the deployment `head`. That publishes a
    // preview and leaves the custom domain on the last production deployment.
    const command = pagesPublishCommand();
    expect(command).toContain("--branch=main");
  });

  it("publishes the environment's own Pages project", () => {
    expect(pagesPublishCommand()).toContain(
      "--project-name ${{ inputs.cloudflare_project }}",
    );
    expect(DEPLOY.jobs["deploy-test"]?.with?.cloudflare_project).toBe(
      "${{ vars.CF_PAGES_TEST }}",
    );
    expect(DEPLOY.jobs["deploy-production"]?.with?.cloudflare_project).toBe(
      "${{ vars.CF_PAGES_PROD }}",
    );
  });
});

describe("CI gate", () => {
  it("verifies a manual dispatch against CI", () => {
    const guard = stepsOf(DEPLOY, "verify-ci").find((step) =>
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
      expect(DEPLOY.jobs[jobId]?.needs).toContain("verify-ci");
    }
  });

  it("keeps the automatic deploy behind a successful CI run", () => {
    expect(DEPLOY.jobs["deploy-test"]?.if).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    for (const jobId of ["build-and-push-api", "build-and-push-garmin"]) {
      expect(DEPLOY.jobs[jobId]?.if).toContain(
        "github.event.workflow_run.conclusion == 'success'",
      );
    }
  });

  it("keeps the production deploy dispatch-only", () => {
    expect(DEPLOY.jobs["deploy-production"]?.if).toBe(
      "github.event_name == 'workflow_dispatch'",
    );
  });

  it("keeps the production approval gate", () => {
    // A job that calls a reusable workflow cannot declare `environment:`, so
    // the production caller passes the environment name and the called job
    // applies it. The approval prompt still gates every production step.
    expect(DEPLOY.jobs["deploy-production"]?.with?.environment_name).toBe(
      "production",
    );
    expect(DEPLOY.jobs["deploy-test"]?.with?.environment_name).toBe("test");
    expect(ENVIRONMENT.jobs.deploy?.environment).toBe(
      "${{ inputs.environment_name }}",
    );
  });
});

describe("reusable environment pipeline", () => {
  it("is called by both environments after both images are built", () => {
    for (const [, job] of callerJobs()) {
      expect(job.needs).toEqual([
        "build-and-push-api",
        "build-and-push-garmin",
      ]);
    }
  });

  it("declares every input and secret the callers pass", () => {
    const call = ENVIRONMENT.on?.workflow_call;
    expect(call).toBeDefined();
    const inputs = Object.keys(call?.inputs ?? {}).sort();
    const secrets = Object.keys(call?.secrets ?? {}).sort();
    expect(inputs.length).toBeGreaterThan(0);
    expect(secrets.length).toBeGreaterThan(0);

    for (const [, job] of callerJobs()) {
      expect(Object.keys(job.with ?? {}).sort()).toEqual(inputs);
      expect(Object.keys(job.secrets ?? {}).sort()).toEqual(secrets);
    }
  });

  it("uses only inputs and secrets it declared", () => {
    const call = ENVIRONMENT.on?.workflow_call;
    const declaredInputs = new Set(Object.keys(call?.inputs ?? {}));
    const declaredSecrets = new Set([
      // The called workflow is automatically granted the caller's token.
      "GITHUB_TOKEN",
      ...Object.keys(call?.secrets ?? {}),
    ]);

    for (const name of new Set(references(ENVIRONMENT_TEXT, "inputs"))) {
      expect(declaredInputs.has(name)).toBe(true);
    }
    for (const name of new Set(references(ENVIRONMENT_TEXT, "secrets"))) {
      expect(declaredSecrets.has(name)).toBe(true);
    }
  });

  it("reports every declared input and secret as required", () => {
    // A caller that stops passing one fails the workflow at run time rather
    // than silently resolving it to an empty string.
    const call = ENVIRONMENT.on?.workflow_call;
    for (const declaration of Object.values(call?.inputs ?? {})) {
      expect(declaration.required).toBe(true);
    }
    for (const declaration of Object.values(call?.secrets ?? {})) {
      expect(declaration.required).toBe(true);
    }
  });

  it("deploys the API before it builds and publishes the web", () => {
    const migrate = stepIndex(ENVIRONMENT, "Run migrations");
    const garmin = stepIndex(ENVIRONMENT, "Deploy Garmin sidecar");
    const bind = stepIndex(ENVIRONMENT, "Allow the API to invoke");
    const api = stepIndex(ENVIRONMENT, "Deploy API to Cloud Run");
    const web = stepIndex(ENVIRONMENT, "Build web");
    const publish = stepIndex(ENVIRONMENT, "Publish to Cloudflare Pages");

    for (const index of [migrate, garmin, bind, api, web, publish]) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(migrate).toBeLessThan(garmin);
    expect(garmin).toBeLessThan(bind);
    expect(bind).toBeLessThan(api);
    expect(api).toBeLessThan(web);
    expect(web).toBeLessThan(publish);
  });

  it("deploys the images the build jobs pushed", () => {
    const deployApi = allSteps(ENVIRONMENT).find((step) =>
      step.name?.startsWith("Deploy API to Cloud Run"),
    );
    const deployGarmin = allSteps(ENVIRONMENT).find((step) =>
      step.name?.startsWith("Deploy Garmin sidecar"),
    );
    expect(deployApi?.run).toContain("--image ${{ inputs.api_image }}");
    expect(deployGarmin?.run).toContain("--image ${{ inputs.garmin_image }}");

    for (const job of Object.values(DEPLOY.jobs)) {
      if (job.uses === ENVIRONMENT_WORKFLOW) {
        expect(job.with?.api_image).toBe(
          "${{ needs.build-and-push-api.outputs.image }}",
        );
        expect(job.with?.garmin_image).toBe(
          "${{ needs.build-and-push-garmin.outputs.image }}",
        );
      }
    }
  });
});

describe("API image", () => {
  it("copies every workspace manifest before the frozen install", async () => {
    // `bun install --frozen-lockfile` resolves the root's workspace:* links
    // before pruning, so a manifest that exists in bun.lock but not on disk
    // fails the API image build even when the API never uses that workspace.
    const rootPackage = (await Bun.file(
      path.join(ROOT, "package.json"),
    ).json()) as {
      workspaces: string[];
    };
    const dockerfile = await Bun.file(
      path.join(ROOT, "apps", "api", "Dockerfile"),
    ).text();
    const installAt = dockerfile.indexOf("RUN bun install --frozen-lockfile");
    expect(installAt).toBeGreaterThan(-1);

    const manifests = rootPackage.workspaces.flatMap((pattern) => [
      ...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: ROOT }),
    ]);
    expect(manifests).toContain("tools/benchmark/package.json");

    const beforeInstall = dockerfile.slice(0, installAt);
    for (const manifest of manifests) {
      expect(beforeInstall).toContain(`COPY ${manifest} ${manifest}`);
    }
  });

  it("pins every globally installed package to an exact version", async () => {
    // A global `bun add` in the image sits outside bun.lock, so an unpinned
    // package would install whatever the registry serves at build time.
    const dockerfile = await Bun.file(
      path.join(ROOT, "apps", "api", "Dockerfile"),
    ).text();
    const installs = dockerfile
      .split("\n")
      .filter((line) => line.startsWith("RUN bun add -g "))
      .flatMap((line) =>
        line.slice("RUN bun add -g ".length).trim().split(/\s+/),
      );
    expect(installs.length).toBeGreaterThan(0);
    for (const install of installs) {
      expect(install).toMatch(/^(@[^/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+$/);
    }
  });
});

describe("concurrency", () => {
  it("serialises each environment without cancelling a running deploy", () => {
    const groups = Object.fromEntries(
      callerJobs().flatMap(([jobId, job]) =>
        job.concurrency ? [[jobId, job.concurrency.group]] : [],
      ),
    );
    expect(groups).toEqual({
      "deploy-test": "deploy-test",
      "deploy-production": "deploy-production",
    });

    for (const job of Object.values(DEPLOY.jobs)) {
      if (job.concurrency) {
        expect(job.concurrency["cancel-in-progress"]).toBe(false);
      }
    }
  });
});
