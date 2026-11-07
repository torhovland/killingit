import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectPackages,
  licenseIdentifier,
  moduleFilePath,
  packageDirectory,
  readLicenceText,
  readPackage,
  renderNotices,
  resolveDependency,
} from "./third-party-notices";

const tempDirs: string[] = [];

/**
 * Builds a throwaway install that matches Bun's isolated layout: a package and
 * its dependency both live under `node_modules/.bun`.
 */
async function makeInstall(): Promise<{
  root: string;
  react: string;
  scheduler: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "killingit-notices-"));
  tempDirs.push(root);
  const entry = join(
    root,
    "node_modules",
    ".bun",
    "react@19.3.1",
    "node_modules",
  );
  const react = join(entry, "react");
  const scheduler = join(entry, "scheduler");
  await mkdir(join(react, "cjs"), { recursive: true });
  await mkdir(join(scheduler, "cjs"), { recursive: true });
  await writeFile(
    join(react, "package.json"),
    JSON.stringify({
      name: "react",
      version: "19.3.1",
      license: "MIT",
      dependencies: { scheduler: "^0.27.0" },
    }),
  );
  // Sentry and zod ship a nested marker manifest that only sets "type".
  await writeFile(
    join(react, "cjs", "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await writeFile(join(react, "LICENSE"), "MIT License\n\nReact text\n");
  await writeFile(join(react, "NOTICE"), "React notice\n");
  await writeFile(join(react, "index.js"), "module.exports = {};\n");
  await writeFile(join(react, "cjs", "react.js"), "module.exports = {};\n");
  await writeFile(
    join(scheduler, "package.json"),
    JSON.stringify({
      name: "scheduler",
      version: "0.27.0",
      license: { type: "MIT" },
    }),
  );
  await writeFile(join(scheduler, "index.js"), "module.exports = {};\n");
  return { root, react, scheduler };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

describe("moduleFilePath", () => {
  it("strips the loader query Vite appends", () => {
    expect(moduleFilePath("/repo/node_modules/react/index.js?v=abc123")).toBe(
      "/repo/node_modules/react/index.js",
    );
  });

  it("ignores virtual modules and modules outside node_modules", () => {
    expect(moduleFilePath("\0vite/preload-helper.js")).toBeUndefined();
    expect(moduleFilePath("/repo/apps/web/src/main.tsx")).toBeUndefined();
  });
});

describe("packageDirectory", () => {
  it("finds the owning package from a nested module", async () => {
    const install = await makeInstall();
    expect(await packageDirectory(join(install.react, "cjs", "react.js"))).toBe(
      install.react,
    );
  });

  it("skips a nested manifest that names no package", async () => {
    const install = await makeInstall();
    expect(
      await packageDirectory(join(install.react, "cjs", "react.js")),
    ).not.toBe(join(install.react, "cjs"));
  });

  it("returns nothing for modules that belong to no package", async () => {
    expect(
      await packageDirectory("/repo/apps/web/src/main.tsx"),
    ).toBeUndefined();
  });
});

describe("licenseIdentifier", () => {
  it("reads a string, an object, and a missing field", () => {
    expect(licenseIdentifier("Apache-2.0")).toBe("Apache-2.0");
    expect(licenseIdentifier({ type: "ISC" })).toBe("ISC");
    expect(licenseIdentifier(undefined)).toBe("UNKNOWN");
    expect(licenseIdentifier("  ")).toBe("UNKNOWN");
  });
});

describe("readLicenceText", () => {
  it("prefers the licence over the notice", async () => {
    const install = await makeInstall();
    expect(await readLicenceText(install.react)).toBe(
      "MIT License\n\nReact text",
    );
  });

  it("returns nothing when the package ships no licence file", async () => {
    const install = await makeInstall();
    expect(await readLicenceText(install.scheduler)).toBeUndefined();
  });
});

describe("readPackage", () => {
  it("reads the manifest and licence text", async () => {
    const install = await makeInstall();
    expect(await readPackage(install.react)).toEqual({
      name: "react",
      version: "19.3.1",
      license: "MIT",
      text: "MIT License\n\nReact text",
    });
  });

  it("falls back to the declared license when no text ships", async () => {
    const install = await makeInstall();
    expect(await readPackage(install.scheduler)).toEqual({
      name: "scheduler",
      version: "0.27.0",
      license: "MIT",
      text: undefined,
    });
  });

  it("skips a directory that is not a package", async () => {
    const install = await makeInstall();
    expect(
      await readPackage(join(install.root, "node_modules")),
    ).toBeUndefined();
  });
});

describe("resolveDependency", () => {
  it("finds a dependency beside the package, as Bun installs it", async () => {
    const install = await makeInstall();
    expect(await resolveDependency(install.react, "scheduler")).toBe(
      install.scheduler,
    );
  });

  it("returns nothing for a dependency that is not installed", async () => {
    const install = await makeInstall();
    expect(
      await resolveDependency(install.react, "missing-package"),
    ).toBeUndefined();
  });
});

describe("collectPackages", () => {
  it("lists each package once, sorted, ignoring app code", async () => {
    const install = await makeInstall();
    const packages = await collectPackages([
      join(install.react, "index.js"),
      join(install.react, "cjs", "react.js"),
      "/repo/apps/web/src/main.tsx",
    ]);
    expect(packages.map((pkg) => pkg.name)).toEqual(["react", "scheduler"]);
    expect(packages[0]?.text).toBe("MIT License\n\nReact text");
  });

  it("follows declared dependencies that ship inside another package", async () => {
    const install = await makeInstall();
    const packages = await collectPackages([join(install.react, "index.js")]);
    expect(packages.map((pkg) => pkg.name)).toContain("scheduler");
  });

  it("keeps a package that lacks a licence file", async () => {
    const install = await makeInstall();
    const packages = await collectPackages([
      join(install.scheduler, "index.js"),
    ]);
    expect(packages).toEqual([
      { name: "scheduler", version: "0.27.0", license: "MIT", text: undefined },
    ]);
  });
});

describe("renderNotices", () => {
  it("carries the project's own terms and every bundled licence", async () => {
    const install = await makeInstall();
    const notices = renderNotices(
      await collectPackages([
        join(install.react, "index.js"),
        join(install.scheduler, "index.js"),
      ]),
    );
    expect(notices).toContain(
      "Required Notice: Copyright (c) 2026 Tor Hovland",
    );
    expect(notices).toContain("PolyForm Noncommercial License");
    expect(notices).toContain("react 19.3.1 — MIT");
    expect(notices).toContain("React text");
    expect(notices).toContain("scheduler 0.27.0 — MIT");
    expect(notices).toContain("No licence file ships with this package");
  });

  it("still renders the project's terms when nothing is bundled", () => {
    const notices = renderNotices([]);
    expect(notices).toContain(
      "Required Notice: Copyright (c) 2026 Tor Hovland",
    );
  });
});
