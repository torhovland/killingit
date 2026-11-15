import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(import.meta.dir, "dev-garmin.sh");

interface DevGarminRun {
  exitCode: number;
  stderr: string;
  requirements: string;
  pip: string[];
  python3: string[];
  python: string[];
}

/** A program that records the arguments it was called with. */
function loggingStub(log: string): string {
  return [
    "#!/bin/sh",
    `printf "%s\\n" "$@" >> "$STUB_LOG/${log}.argv"`,
    "",
  ].join("\n");
}

/** Stands in for `python3 -m venv`: it creates the two programs the script runs
 * next instead of a real virtualenv, so no Python or network is needed. */
const PYTHON3_STUB = [
  "#!/bin/sh",
  'printf "%s\\n" "$@" >> "$STUB_LOG/python3.argv"',
  'venv="$3"',
  'mkdir -p "$venv/bin"',
  "cat > \"$venv/bin/python\" <<'PYTHON'",
  "#!/bin/sh",
  'printf "%s\\n" "$@" >> "$STUB_LOG/python.argv"',
  "PYTHON",
  "cat > \"$venv/bin/pip\" <<'PIP'",
  "#!/bin/sh",
  'printf "%s\\n" "$@" >> "$STUB_LOG/pip.argv"',
  "PIP",
  'chmod +x "$venv/bin/python" "$venv/bin/pip"',
  "",
].join("\n");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function readArguments(filePath: string): Promise<string[]> {
  const text = await readFile(filePath, "utf8").catch(() => "");
  return text.split("\n").filter((line) => line !== "");
}

async function writeStub(file: string, log: string): Promise<void> {
  await writeFile(file, loggingStub(log));
  await chmod(file, 0o755);
}

async function runDevGarmin(virtualenvExists: boolean): Promise<DevGarminRun> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dev-garmin-"));
  temporaryDirectories.push(directory);
  const logDirectory = path.join(directory, "log");
  await mkdir(logDirectory);

  // The script finds the sidecar from its own location, so copy it into a
  // throwaway tree that has a stub `services/garmin` beside it.
  const scriptsDirectory = path.join(directory, "scripts");
  await mkdir(scriptsDirectory);
  const script = path.join(scriptsDirectory, "dev-garmin.sh");
  await copyFile(SCRIPT, script);
  const sidecarDirectory = path.join(directory, "services", "garmin");
  await mkdir(sidecarDirectory, { recursive: true });
  const requirements = path.join(sidecarDirectory, "requirements.txt");
  await writeFile(requirements, "fastapi==1.0.0\n");

  const binDirectory = path.join(directory, "bin");
  await mkdir(binDirectory);
  await writeFile(path.join(binDirectory, "python3"), PYTHON3_STUB);
  await chmod(path.join(binDirectory, "python3"), 0o755);

  if (virtualenvExists) {
    const venvBin = path.join(sidecarDirectory, ".venv", "bin");
    await mkdir(venvBin, { recursive: true });
    await writeStub(path.join(venvBin, "python"), "python");
    await writeStub(path.join(venvBin, "pip"), "pip");
  }

  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  Object.assign(environment, {
    PATH: `${binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    STUB_LOG: logDirectory,
  });

  const child = Bun.spawn(["bash", script], {
    cwd: directory,
    env: environment,
    stderr: "pipe",
    stdout: "ignore",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return {
    exitCode,
    stderr,
    requirements,
    pip: await readArguments(path.join(logDirectory, "pip.argv")),
    python3: await readArguments(path.join(logDirectory, "python3.argv")),
    python: await readArguments(path.join(logDirectory, "python.argv")),
  };
}

describe("dev-garmin.sh", () => {
  it("installs the current requirements into an existing virtualenv", async () => {
    const run = await runDevGarmin(true);

    expect(run.exitCode).toBe(0);
    // A changed requirements.txt has to reach a virtualenv created earlier.
    expect(run.pip).toContain("install");
    expect(run.pip).toContain("-r");
    expect(run.pip).toContain(run.requirements);
  });

  it("creates the virtualenv only when it is missing", async () => {
    const missing = await runDevGarmin(false);

    expect(missing.exitCode).toBe(0);
    expect(missing.python3).toContain("-m");
    expect(missing.python3).toContain("venv");
    expect(missing.pip).toContain(missing.requirements);

    const existing = await runDevGarmin(true);
    expect(existing.exitCode).toBe(0);
    expect(existing.python3).toEqual([]);
  });

  it("starts uvicorn from the virtualenv", async () => {
    const run = await runDevGarmin(true);

    expect(run.exitCode).toBe(0);
    expect(run.python).toContain("-m");
    expect(run.python).toContain("uvicorn");
    expect(run.python).toContain("app:app");
  });
});
