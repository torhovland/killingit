import { describe, expect, it } from "bun:test";
import path from "node:path";

interface PackageManifest {
  scripts?: Record<string, string | undefined>;
  workspaces?: string[];
}

interface TypeScriptProject {
  include?: string[];
}

/** Directories that hold generated output or dependencies, never source. */
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "__pycache__",
]);

const ROOT = path.resolve(import.meta.dir, "..");
const SCRIPT_PROJECT_PATH = path.join(ROOT, "tsconfig.scripts.json");

const ROOT_PACKAGE = (await Bun.file(
  path.join(ROOT, "package.json"),
).json()) as PackageManifest;
const SCRIPT_PROJECT = (await Bun.file(
  SCRIPT_PROJECT_PATH,
).json()) as TypeScriptProject;

/**
 * The directories that root `workspaces` globs resolve to. Their TypeScript is
 * checked by the workspace's own `tsconfig.json`, not by the root project.
 */
const WORKSPACE_DIRECTORIES = (ROOT_PACKAGE.workspaces ?? []).flatMap(
  (pattern) =>
    [...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: ROOT })].map(
      (manifest) => path.dirname(manifest),
    ),
);

/** Every TypeScript file the given tsconfig `include` patterns select. */
function filesMatching(patterns: readonly string[]): Set<string> {
  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: ROOT })) {
      files.add(file);
    }
  }
  return files;
}

/** Every TypeScript file in the repository, minus generated and workspace trees. */
function repositoryTypeScriptFiles(): string[] {
  const files = new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: ROOT });
  return [...files].filter(
    (file) =>
      !file.split("/").some((segment) => IGNORED_DIRECTORIES.has(segment)) &&
      !WORKSPACE_DIRECTORIES.some(
        (directory) => file === directory || file.startsWith(`${directory}/`),
      ),
  );
}

const SCRIPT_PROJECT_FILES = filesMatching(SCRIPT_PROJECT.include ?? []);
const UNCOVERED_FILES = repositoryTypeScriptFiles().filter(
  (file) => !SCRIPT_PROJECT_FILES.has(file),
);

const WORKSPACES = await Promise.all(
  WORKSPACE_DIRECTORIES.map(async (directory) => {
    const manifest = (await Bun.file(
      path.join(ROOT, directory, "package.json"),
    ).json()) as PackageManifest;
    return {
      directory,
      typecheck: manifest.scripts?.typecheck,
      hasTsconfig: await Bun.file(
        path.join(ROOT, directory, "tsconfig.json"),
      ).exists(),
    };
  }),
);

describe("tsconfig.scripts.json", () => {
  it("checks every TypeScript file that belongs to no workspace package", () => {
    expect(UNCOVERED_FILES).toEqual([]);
  });

  it("is not an empty project", () => {
    expect(SCRIPT_PROJECT_FILES.size).toBeGreaterThan(0);
    expect(SCRIPT_PROJECT_FILES.has("scripts/coverage.ts")).toBe(true);
  });

  it("runs from the root typecheck script", () => {
    expect(ROOT_PACKAGE.scripts?.typecheck).toContain("tsconfig.scripts.json");
  });
});

describe("workspace typechecking", () => {
  it("gives every workspace a tsconfig and a typecheck script", () => {
    expect(WORKSPACES.length).toBeGreaterThan(0);
    for (const workspace of WORKSPACES) {
      expect({
        directory: workspace.directory,
        hasTsconfig: workspace.hasTsconfig,
        hasTypecheck: workspace.typecheck !== undefined,
      }).toEqual({
        directory: workspace.directory,
        hasTsconfig: true,
        hasTypecheck: true,
      });
    }
  });
});
