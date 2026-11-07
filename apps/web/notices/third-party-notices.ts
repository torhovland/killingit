import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

/**
 * Every build ships its dependency notices at the site root, so a browser that
 * receives the bundled JavaScript also receives the licences of the code it
 * contains.
 */
export const NOTICES_FILE = "third-party-licenses.txt";

const LICENCE_FILE_PATTERN = /^(licen[cs]e|copying|notice)/i;

const SOURCE_MAP_EXTENSION = ".map";

/** The licence obligations that must travel with the deployed web app. */
export const NOTICES_TITLE = "Third-party licences";

export interface ThirdPartyPackage {
  name: string;
  version: string;
  /** SPDX identifier from `package.json`, or `UNKNOWN` when it declares none. */
  license: string;
  /** Full licence text from the package, when it ships one. */
  text: string | undefined;
}

/**
 * Strips the loader query Vite appends to module ids (`?v=hash`,
 * `?commonjs-proxy`), and drops virtual modules, which have no package behind
 * them. Returns `undefined` for anything outside `node_modules`.
 */
export function moduleFilePath(moduleId: string): string | undefined {
  if (moduleId.startsWith("\0")) {
    return undefined;
  }
  const path = moduleId.split("?")[0] ?? moduleId;
  return path.includes("node_modules") ? path : undefined;
}

/**
 * Finds the package that owns a module by walking up to the nearest
 * `package.json` that names a package. Bun's isolated install puts a package
 * and its dependencies under `node_modules/.bun/...`, so the layout cannot be
 * assumed, and some packages (Sentry, zod) ship nested `package.json` marker
 * files that only set `{"type": "module"}` and must be skipped.
 */
export async function packageDirectory(
  moduleId: string,
): Promise<string | undefined> {
  const path = moduleFilePath(moduleId);
  if (!path) {
    return undefined;
  }
  let directory = dirname(path);
  for (;;) {
    const manifest = await readManifest(directory);
    if (manifest?.name) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

interface Manifest {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  dependencies?: Record<string, string>;
}

/** Reads a package manifest, or `undefined` when there is no valid one. */
export async function readManifest(
  directory: string,
): Promise<Manifest | undefined> {
  try {
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as Manifest;
    return typeof manifest === "object" && manifest ? manifest : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves a dependency the way Node does: the package's own `node_modules`
 * first, then each parent's. Bun's isolated install keeps a package's
 * dependencies beside it under `node_modules/.bun/`, so the walk finds them.
 */
export async function resolveDependency(
  fromDirectory: string,
  name: string,
): Promise<string | undefined> {
  let directory = fromDirectory;
  for (;;) {
    const candidate = join(directory, "node_modules", name);
    const manifest = await readManifest(candidate);
    if (manifest?.name) {
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

/** Reads a package's manifest and licence text, or nothing when it has none. */
export async function readPackage(
  directory: string,
): Promise<ThirdPartyPackage | undefined> {
  const manifest = await readManifest(directory);
  if (!manifest?.name) {
    return undefined;
  }
  return {
    name: manifest.name,
    version: manifest.version ?? "0.0.0",
    license: licenseIdentifier(manifest.license),
    text: await readLicenceText(directory),
  };
}

/** Turns the `license` field, which may be an object, into an identifier. */
export function licenseIdentifier(
  license: string | { type?: string } | undefined,
): string {
  if (typeof license === "string" && license.trim() !== "") {
    return license.trim();
  }
  if (license && typeof license === "object" && license.type) {
    return license.type;
  }
  return "UNKNOWN";
}

/**
 * Reads the licence file a package ships. A `LICENSE`/`LICENCE` file wins over
 * `COPYING` and `NOTICE`, so the terms are included rather than only the
 * attribution line.
 */
export async function readLicenceText(
  directory: string,
): Promise<string | undefined> {
  const files = await readdir(directory).catch(() => [] as string[]);
  const candidates = files
    .filter((file) => LICENCE_FILE_PATTERN.test(file))
    .filter((file) => !file.endsWith(SOURCE_MAP_EXTENSION))
    .sort(compareLicenceFiles);
  const file = candidates[0];
  if (!file) {
    return undefined;
  }
  const text = await readFile(join(directory, file), "utf8").catch(
    () => undefined,
  );
  return text?.trim() || undefined;
}

function compareLicenceFiles(a: string, b: string): number {
  const rank = (file: string) =>
    /^licen[cs]e/i.test(file) ? 0 : /^copying/i.test(file) ? 1 : 2;
  return rank(a) - rank(b) || a.length - b.length || a.localeCompare(b);
}

/**
 * Collects one entry per package the build needs, sorted by name and version.
 *
 * Roots are the packages that own bundled modules, then each root's declared
 * dependencies are followed. That second step is required because a published
 * package can contain another package's code in its own dist file —
 * `@auth0/auth0-react` ships `auth0-spa-js` that way — where no bundler
 * metadata reveals it. Following dependencies can list a package that
 * tree-shaking dropped, which over-reports a licence rather than omitting one.
 */
export async function collectPackages(
  moduleIds: readonly string[],
): Promise<ThirdPartyPackage[]> {
  const queue: string[] = [];
  for (const moduleId of moduleIds) {
    const directory = await packageDirectory(moduleId);
    if (directory) {
      queue.push(directory);
    }
  }

  const packages = new Map<string, ThirdPartyPackage>();
  const seen = new Set<string>();
  while (queue.length > 0) {
    const directory = queue.shift() as string;
    if (seen.has(directory)) {
      continue;
    }
    seen.add(directory);
    const found = await readPackage(directory);
    if (!found) {
      continue;
    }
    packages.set(`${found.name}@${found.version}`, found);
    const manifest = await readManifest(directory);
    for (const name of Object.keys(manifest?.dependencies ?? {})) {
      const resolved = await resolveDependency(directory, name);
      if (resolved) {
        queue.push(resolved);
      }
    }
  }
  return [...packages.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

/** Renders the notices file: the app's own terms, then each bundled licence. */
export function renderNotices(packages: readonly ThirdPartyPackage[]): string {
  return [
    NOTICES_TITLE,
    "=".repeat(NOTICES_TITLE.length),
    "",
    "Killing It is source-available under the PolyForm Noncommercial License",
    "1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0).",
    "Commercial use is not permitted.",
    "",
    "Required Notice: Copyright (c) 2026 Tor Hovland",
    "",
    "The web app bundles the packages below. Each stays under its own licence,",
    "reproduced in full.",
    "",
    ...packages.map(renderPackage),
  ].join("\n");
}

function renderPackage(pkg: ThirdPartyPackage): string {
  const rule = "-".repeat(80);
  const body =
    pkg.text ??
    "No licence file ships with this package; see its package.json.";
  return `${rule}\n${pkg.name} ${pkg.version} — ${pkg.license}\n${rule}\n\n${body}\n`;
}

/**
 * Vite plugin that emits `third-party-licenses.txt` next to the bundled
 * JavaScript, listing the packages the build loaded. Build-only, so the dev
 * server needs no notices.
 *
 * The package list comes from `this.getModuleIds()` rather than each output
 * chunk's `modules` map: Rolldown merges modules into chunks and the chunk's
 * map under-reports (it omits, for example, most of Sentry's browser SDK), so
 * chunk introspection would silently drop notices. The module graph can
 * include a module that tree-shaking later removed, which over-reports a
 * licence — the safe direction to be wrong.
 */
export function thirdPartyNoticesPlugin(): Plugin {
  return {
    name: "killingit-third-party-notices",
    apply: "build",
    async generateBundle() {
      const packages = await collectPackages([...this.getModuleIds()]);
      for (const pkg of packages) {
        if (!pkg.text) {
          this.warn(
            `${pkg.name}@${pkg.version} ships no licence text; the notices file names its declared license instead`,
          );
        }
      }
      this.emitFile({
        type: "asset",
        fileName: NOTICES_FILE,
        source: renderNotices(packages),
      });
    },
  };
}
