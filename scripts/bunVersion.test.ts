import { describe, expect, it } from "bun:test";
import path from "node:path";

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs: Record<string, WorkflowJob>;
}

const REPO_ROOT = path.resolve(import.meta.dir, "..");

/** The one file that names the Bun version every job installs. */
const VERSION_FILE = ".bun-version";

const BUN_VERSION = (
  await Bun.file(path.join(REPO_ROOT, VERSION_FILE)).text()
).trim();

const WORKFLOW_FILES = [
  "ci.yml",
  "deploy.yml",
  "deploy-environment.yml",
] as const;

const WORKFLOWS = await Promise.all(
  WORKFLOW_FILES.map(async (file) => {
    const text = await Bun.file(
      path.join(REPO_ROOT, ".github", "workflows", file),
    ).text();
    return {
      file,
      text,
      parsed: Bun.YAML.parse(text) as Workflow,
    };
  }),
);

/** Every step of every job in the given workflow. */
function allSteps(workflow: Workflow): WorkflowStep[] {
  return Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
}

/** The steps that install Bun through the setup action. */
function setupBunSteps(workflow: Workflow): WorkflowStep[] {
  return allSteps(workflow).filter(
    (step) => step.uses === "oven-sh/setup-bun@v2",
  );
}

/** The `oven/bun:<tag>` image tags a Dockerfile builds from. */
function bunImageTags(dockerfile: string): string[] {
  return [...dockerfile.matchAll(/^FROM\s+oven\/bun:(\S+)/gm)].map(
    (match) => match[1] ?? "",
  );
}

describe("Bun version", () => {
  it("names one release, without a range or a tag prefix", () => {
    expect(BUN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is installed through the version file by every setup-bun step", () => {
    const steps = WORKFLOWS.flatMap((workflow) =>
      setupBunSteps(workflow.parsed).map((step) => ({
        file: workflow.file,
        step,
      })),
    );
    // Without this the assertions below hold for a workflow with no Bun step.
    expect(steps.length).toBeGreaterThan(0);

    for (const { file, step } of steps) {
      expect({ file, versionFile: step.with?.["bun-version-file"] }).toEqual({
        file,
        versionFile: VERSION_FILE,
      });
      // A literal `bun-version:` would win over the file and drift silently.
      expect(Object.keys(step.with ?? {})).not.toContain("bun-version");
    }
  });

  it("is not repeated as a literal in a workflow", () => {
    for (const workflow of WORKFLOWS) {
      expect(workflow.text).not.toMatch(/\bbun-version:\s*[^\s$]/);
      expect(workflow.text).not.toMatch(/\bbun-v\d/);
    }
  });

  it("is read by the e2e job, which cannot use setup-bun", () => {
    const workflow = WORKFLOWS.find(({ file }) => file === "ci.yml");
    expect(workflow).toBeDefined();
    const downloads = allSteps(workflow?.parsed ?? { jobs: {} }).filter(
      (step) => step.run?.includes("releases/download/bun-v"),
    );
    expect(downloads).toHaveLength(1);

    const script = downloads[0]?.run ?? "";
    expect(script).toContain(`BUN_VERSION="$(cat ${VERSION_FILE})"`);
    expect(script).toContain("bun-v${BUN_VERSION}/bun-linux-x64.zip");
  });

  it("is the tag the API image builds from", async () => {
    const tags = (
      await Promise.all(
        [...new Bun.Glob("**/Dockerfile").scanSync({ cwd: REPO_ROOT })]
          .filter((file) => !file.split("/").includes("node_modules"))
          .map(async (file) =>
            bunImageTags(await Bun.file(path.join(REPO_ROOT, file)).text()).map(
              (tag) => ({ file, tag }),
            ),
          ),
      )
    ).flat();
    expect(tags.length).toBeGreaterThan(0);

    for (const { file, tag } of tags) {
      // `1.4.4-slim` is the same release; a bare `1` would float.
      expect({ file, tag, version: tag.split("-")[0] }).toEqual({
        file,
        tag,
        version: BUN_VERSION,
      });
    }
  });

  it("is the version the coverage baseline was measured with", async () => {
    const coverage = await Bun.file(
      path.join(REPO_ROOT, "scripts", "coverage.ts"),
    ).text();
    // The baseline's line counts change between Bun releases, so the comment
    // has to point at the file instead of repeating a number that can go stale.
    expect(coverage).toContain(VERSION_FILE);
    expect(coverage).not.toMatch(/\bBun \d+\.\d+\.\d+\b/);
  });
});
