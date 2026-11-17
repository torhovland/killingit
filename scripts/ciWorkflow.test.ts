import { describe, expect, it } from "bun:test";
import path from "node:path";

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  if?: string;
  with?: Record<string, unknown>;
  "continue-on-error"?: boolean;
}

interface WorkflowJob {
  "runs-on"?: string;
  needs?: string[];
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs: Record<string, WorkflowJob>;
}

interface CompositeAction {
  runs?: {
    using?: string;
    steps?: WorkflowStep[];
  };
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

async function readAction(name: string): Promise<CompositeAction> {
  const text = await Bun.file(
    path.join(REPO_ROOT, ".github", "actions", name, "action.yml"),
  ).text();
  return Bun.YAML.parse(text) as CompositeAction;
}

async function readManifest(directory: string): Promise<PackageManifest> {
  const manifestPath = path.join(REPO_ROOT, directory, "package.json");
  return (await Bun.file(manifestPath).json()) as PackageManifest;
}

const CI = await readWorkflow("ci.yml");
const DEPLOY = await readWorkflow("deploy.yml");
const BUILD_JOB = CI.jobs["build"];

/** The step every install job runs after its checkout. */
const SETUP_ACTION = "./.github/actions/setup-bun-install";
const SETUP_ACTION_RUNS = (await readAction("setup-bun-install")).runs;

/**
 * The CI jobs that need a checkout, the pinned Bun release and a frozen
 * workspace install. A new job joins this list deliberately instead of copying
 * the steps again.
 */
const SETUP_ACTION_JOBS = [
  "typecheck",
  "lint",
  "format",
  "unused",
  "build",
  "test",
  "integration",
  "outdated",
] as const;

/** The actions the build job may use: checkout, Bun setup directly or through
 * the shared action, and nothing that talks to a registry or a remote service. */
const ALLOWED_ACTIONS = new Set([
  "actions/checkout@v5",
  "oven-sh/setup-bun@v2",
  SETUP_ACTION,
]);

/** The sidecar's runtime modules are hard-listed in its Dockerfile `COPY`, so a
 * module `app.py` imports but the list forgets builds green and fails on first
 * request. Importing the app once in the built image proves they resolve. */
const GARMIN_IMAGE = "killingit-garmin:ci";
const GARMIN_SMOKE_COMMAND = `docker run --rm ${GARMIN_IMAGE} python -c "import app"`;

function usesSetupAction(job: WorkflowJob | undefined): boolean {
  return (job?.steps ?? []).some((step) => step.uses === SETUP_ACTION);
}

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

  it("imports the Garmin sidecar from the image it builds", () => {
    const steps = buildSteps();
    const buildAt = steps.findIndex((step) =>
      step.run?.startsWith(
        `docker build --file services/garmin/Dockerfile --tag ${GARMIN_IMAGE} `,
      ),
    );
    const smokeAt = steps.findIndex(
      (step) => step.run === GARMIN_SMOKE_COMMAND,
    );

    // The import only proves anything against the image this job just built, so
    // the step must follow the build and must not be dropped. Retagging the
    // build also fails here, before the image is ever run.
    expect(buildAt).toBeGreaterThan(-1);
    expect(smokeAt).toBe(buildAt + 1);
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

    // Every `run` is covered, including the sidecar's one-shot import.
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
    expect(steps[1]?.uses).toBe(SETUP_ACTION);

    // The frozen install runs inside the action, so its step must stay ahead
    // of the bundle rather than being moved after it.
    const setupAt = steps.findIndex((step) => step.uses === SETUP_ACTION);
    const buildAt = steps.findIndex((step) => step.run === "bun run build");
    expect(setupAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(setupAt);
  });
});

describe("shared setup action", () => {
  it("installs Bun and the workspace dependencies", () => {
    expect(SETUP_ACTION_RUNS?.using).toBe("composite");
    const steps = SETUP_ACTION_RUNS?.steps ?? [];

    // A local `./.github/actions/...` path is resolved from the workspace,
    // which is empty until the caller checks out, so the action must not try
    // to check the repository out itself.
    expect(steps.some((step) => step.uses === "actions/checkout@v5")).toBe(
      false,
    );

    const bun = steps.find((step) => step.uses === "oven-sh/setup-bun@v2");
    expect(bun?.with?.["bun-version-file"]).toBe(".bun-version");

    const install = steps.find(
      (step) => step.run === "bun install --frozen-lockfile",
    );
    expect(install?.shell).toBe("bash");
  });

  it("runs in exactly the jobs that install the dependencies", () => {
    const withAction = Object.entries(CI.jobs)
      .filter(([, job]) => usesSetupAction(job))
      .map(([jobId]) => jobId)
      .sort();
    expect(withAction).toEqual([...SETUP_ACTION_JOBS].sort());

    for (const [jobId, job] of Object.entries(CI.jobs)) {
      const installs = (job.steps ?? []).some(
        (step) => step.run === "bun install --frozen-lockfile",
      );
      // e2e installs the pinned release by hand in the Playwright image, so it
      // is the one job allowed to run the frozen install without the action.
      // Every other job must get it from the action, never a copy of the steps.
      expect({ jobId, installs }).toEqual({
        jobId,
        installs: jobId === "e2e",
      });
    }
  });
});
