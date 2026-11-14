import { describe, expect, it } from "bun:test";
import path from "node:path";

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  "continue-on-error"?: boolean;
}

interface WorkflowJob {
  "runs-on"?: string;
  needs?: string[];
  steps?: WorkflowStep[];
}

interface WorkflowTrigger {
  schedule?: Array<{ cron?: string }>;
  workflow_dispatch?: unknown;
  pull_request?: unknown;
  push?: unknown;
}

interface Workflow {
  on?: WorkflowTrigger;
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

interface PackageManifest {
  scripts?: Record<string, string>;
}

interface ImageBuild {
  file: string;
  context: string;
}

const REPO_ROOT = path.resolve(import.meta.dir, "..");

async function readWorkflow(name: string): Promise<Workflow> {
  const text = await Bun.file(
    path.join(REPO_ROOT, ".github", "workflows", name),
  ).text();
  return Bun.YAML.parse(text) as Workflow;
}

async function readManifest(directory: string): Promise<PackageManifest> {
  const manifestPath = path.join(REPO_ROOT, directory, "package.json");
  return (await Bun.file(manifestPath).json()) as PackageManifest;
}

const CI = await readWorkflow("ci.yml");
const DEPLOY = await readWorkflow("deploy.yml");
const OUTDATED = await readWorkflow("outdated.yml");
const BUILD_JOB = CI.jobs["build"];

/** The actions the build job may use: checkout, Bun, and nothing that talks to
 * a registry or a remote service. */
const ALLOWED_ACTIONS = new Set([
  "actions/checkout@v5",
  "oven-sh/setup-bun@v2",
]);

function buildSteps(): WorkflowStep[] {
  return BUILD_JOB?.steps ?? [];
}

function runCommands(): string[] {
  return buildSteps().flatMap((step) => (step.run ? [step.run] : []));
}

function ciImageBuilds(): ImageBuild[] {
  return runCommands()
    .filter((command) => command.startsWith("docker build "))
    .map(parseDockerBuild);
}

function deployImageBuilds(): ImageBuild[] {
  return Object.values(DEPLOY.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.uses?.startsWith("docker/build-push-action@"))
    .map((step) => ({
      file: String(step.with?.["file"]),
      context: String(step.with?.["context"]),
    }));
}

/**
 * Reads the Dockerfile and the positional build context from one `docker
 * build` command. The job's steps are single-line commands, so a rewrite into
 * quoting or line continuations fails the test loudly instead of being parsed
 * wrongly.
 */
function parseDockerBuild(command: string): ImageBuild {
  const tokens = command.trim().split(/\s+/);
  const flagValues = new Set<number>();
  for (const [index, token] of tokens.entries()) {
    const takesValue = ["--file", "-f", "--tag", "-t", "--platform"].includes(
      token,
    );
    if (takesValue) {
      flagValues.add(index);
      flagValues.add(index + 1);
    }
  }
  const [commandName, subcommand, context, ...rest] = tokens.filter(
    (_, index) => !flagValues.has(index),
  );
  const fileIndex = tokens.findIndex(
    (token) => token === "--file" || token === "-f",
  );
  const file = fileIndex < 0 ? "" : (tokens[fileIndex + 1] ?? "");
  if (
    commandName !== "docker" ||
    subcommand !== "build" ||
    file === "" ||
    context === undefined ||
    rest.length > 0
  ) {
    throw new Error(`Unexpected docker build command: ${command}`);
  }
  return { file, context };
}

function imageKey(build: ImageBuild): string {
  return `${build.file} ${build.context}`;
}

describe("build job", () => {
  it("runs the web app's production bundle, not just its typecheck", async () => {
    const commands = runCommands();
    const buildAt = commands.indexOf("bun run build");
    expect(buildAt).toBeGreaterThan(-1);

    // The root script must stay a per-workspace build, and the web app's own
    // build must stay a real `vite build`; otherwise this job typechecks the
    // web app and proves nothing about the bundle the deploy ships.
    const root = await readManifest("");
    expect(root.scripts?.["build"]).toBe("bun run --filter '*' build");
    const web = await readManifest("apps/web");
    expect(web.scripts?.["build"]).toContain("vite build");

    // The bundle is the cheapest failing step, so it runs before the images.
    for (const [index, command] of commands.entries()) {
      if (command.startsWith("docker build ")) {
        expect(index).toBeGreaterThan(buildAt);
      }
    }
  });

  it("builds the same Dockerfile and context pairs as the deploy", async () => {
    const ciBuilds = ciImageBuilds();
    const deployBuilds = deployImageBuilds();
    expect(ciBuilds).toHaveLength(2);
    expect(deployBuilds).toHaveLength(2);

    // A later edit may not drop an image here or point the gate at a different
    // Dockerfile than the one the deploy builds.
    expect(ciBuilds.map(imageKey).sort()).toEqual(
      deployBuilds.map(imageKey).sort(),
    );
    for (const build of ciBuilds) {
      const dockerfile = Bun.file(path.join(REPO_ROOT, build.file));
      expect(await dockerfile.exists()).toBe(true);
    }
  });

  it("neither pushes nor logs in nor takes a secret", () => {
    // Without this the assertions below hold for a job that has no steps.
    expect(buildSteps().length).toBeGreaterThan(0);
    for (const step of buildSteps()) {
      expect(step["continue-on-error"]).toBeUndefined();
      if (step.uses !== undefined) {
        expect(ALLOWED_ACTIONS.has(step.uses)).toBe(true);
      }
      expect(Object.keys(step.with ?? {})).not.toContain("secrets");
      expect(Object.keys(step.with ?? {})).not.toContain("build-args");
    }

    for (const command of runCommands()) {
      expect(command).not.toMatch(/(^|\s)--(push|secret|build-arg)\b/);
      expect(command).not.toMatch(/\bdocker\s+login\b/);
      expect(command).not.toContain("SENTRY");
    }
  });

  it("builds on the deploy's amd64 runner without qemu", () => {
    expect(BUILD_JOB?.["runs-on"]).toBe("ubuntu-latest");
    for (const jobId of ["build-and-push-api", "build-and-push-garmin"]) {
      expect(DEPLOY.jobs[jobId]?.["runs-on"]).toBe("ubuntu-latest");
    }
    for (const step of buildSteps()) {
      expect(step.uses ?? "").not.toContain("qemu");
    }
    for (const command of runCommands()) {
      expect(command).not.toMatch(/--platform(?!\s+linux\/amd64)/);
    }
  });

  it("follows the shape of the other jobs", () => {
    const steps = buildSteps();
    expect(steps[0]?.uses).toBe("actions/checkout@v5");
    expect(steps.some((step) => step.uses === "oven-sh/setup-bun@v2")).toBe(
      true,
    );

    const commands = runCommands();
    expect(commands).toContain("bun install --frozen-lockfile");
    expect(commands.indexOf("bun install --frozen-lockfile")).toBeLessThan(
      commands.indexOf("bun run build"),
    );
  });
});

describe("dependency freshness", () => {
  const OUTDATED_JOB = OUTDATED.jobs["outdated"];

  function outdatedCommands(): string[] {
    return (OUTDATED_JOB?.steps ?? []).flatMap((step) =>
      step.run ? [step.run] : [],
    );
  }

  it("keeps the registry check off every pull request", () => {
    // A release published while a pull request is open must not decide that
    // pull request's result, so the check lives in its own workflow and CI
    // knows nothing about it.
    expect(CI.jobs["outdated"]).toBeUndefined();
    for (const job of Object.values(CI.jobs)) {
      for (const step of job.steps ?? []) {
        expect(step.run ?? "").not.toContain("outdated");
      }
    }
    expect(OUTDATED.on?.pull_request).toBeUndefined();
    expect(OUTDATED.on?.push).toBeUndefined();
  });

  it("runs daily and on demand on the default branch", () => {
    const crons = OUTDATED.on?.schedule?.map((entry) => entry.cron ?? "");
    expect(crons).toHaveLength(1);
    // Five fields, each a fixed value: once a day.
    expect(crons?.[0]).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    expect(OUTDATED.on?.workflow_dispatch).toBeDefined();
  });

  it("fails the run loudly when a dependency is outdated", () => {
    expect(OUTDATED.permissions).toEqual({ contents: "read" });
    expect(OUTDATED_JOB?.["runs-on"]).toBe("ubuntu-latest");

    const steps = OUTDATED_JOB?.steps ?? [];
    expect(steps[0]?.uses).toBe("actions/checkout@v5");
    expect(steps.some((step) => step.uses === "oven-sh/setup-bun@v2")).toBe(
      true,
    );

    const commands = outdatedCommands();
    expect(commands).toContain("bun install --frozen-lockfile");
    expect(commands).toContain("bun run outdated");
    expect(commands.indexOf("bun install --frozen-lockfile")).toBeLessThan(
      commands.indexOf("bun run outdated"),
    );

    // The failed run is the report, so no step may be excused from failing or
    // skipped by a condition.
    for (const step of steps) {
      expect(step["continue-on-error"]).toBeUndefined();
      expect(step.if).toBeUndefined();
    }
  });
});
