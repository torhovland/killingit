import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { APP_BUILD_META_NAME, APP_BUILD_PLACEHOLDER } from "./buildId";

/** Source template, kept outside `public/` so Vite does not copy it as-is. */
export const SERVICE_WORKER_SOURCE = "pwa/service-worker.js";

/** The generated worker lands at the site root so its scope is the whole app. */
export const SERVICE_WORKER_OUTPUT = "sw.js";

/** The meta tag the build stamps with the cache version it also gives the worker. */
const APP_BUILD_META = new RegExp(
  `<meta\\s+name="${APP_BUILD_META_NAME}"\\s+content="[^"]*"\\s*\\/?>`,
);

/** Cloudflare Pages host files are not app assets and are not precached. */
const HOST_FILES = new Set(["_headers", "_redirects"]);

const SOURCE_MAP_EXTENSION = ".map";

export interface BuildServiceWorkerOptions {
  /** Finished Vite output directory. */
  distDir: string;
  /** Template path (`apps/web/pwa/service-worker.js`). */
  sourceFile: string;
}

export interface BuildServiceWorkerResult {
  cacheVersion: string;
  precacheUrls: string[];
}

/**
 * Converts build file names into the URL list the worker precaches. Paths are
 * POSIX-style in the output, and `/` is included next to `/index.html` so a
 * cold start can answer either form.
 */
export function toPrecacheUrls(files: readonly string[]): string[] {
  const urls = files
    .map(toPosixPath)
    .filter(isPrecachedFile)
    .map((file) => `/${file}`);
  return ["/", ...urls];
}

/** Whether a build file belongs in the offline app shell. */
export function isPrecachedFile(file: string): boolean {
  const normalized = toPosixPath(file);
  if (normalized === "" || normalized === SERVICE_WORKER_OUTPUT) {
    return false;
  }
  if (normalized.endsWith(SOURCE_MAP_EXTENSION)) {
    return false;
  }
  return !HOST_FILES.has(normalized.split("/").at(-1) ?? normalized);
}

/**
 * Reads the finished build, creates a content-addressed cache version, and
 * writes the generated worker. The template's source is part of the hash, so a
 * worker logic change also retires the previous cache. The same version is
 * stamped into `index.html` as the page's build id, which lets the app tell a
 * waiting worker for its own build from a genuine update.
 */
export async function buildServiceWorker(
  options: BuildServiceWorkerOptions,
): Promise<BuildServiceWorkerResult> {
  const files = await listBuildFiles(options.distDir);
  if (!files.includes("index.html")) {
    throw new Error("Service worker build requires dist/index.html");
  }
  if (!files.includes("offline.html")) {
    throw new Error("Service worker build requires dist/offline.html");
  }

  const source = await readFile(options.sourceFile, "utf8");
  if (
    !source.includes("__CACHE_VERSION__") ||
    !source.includes("__PRECACHE_URLS__")
  ) {
    throw new Error("Service worker template has no injection placeholders");
  }
  const indexHtml = await readFile(join(options.distDir, "index.html"), "utf8");
  if (!APP_BUILD_META.test(indexHtml)) {
    throw new Error(`dist/index.html has no ${APP_BUILD_META_NAME} meta tag`);
  }
  // Hash the shell as it looks before the build id is stamped in, so an
  // identical rebuild keeps the same version instead of hashing its own output.
  const hashedIndexHtml = indexHtml.replace(
    APP_BUILD_META,
    buildMetaTag(APP_BUILD_PLACEHOLDER),
  );
  const hash = createHash("sha256").update(source);
  for (const file of files.filter(isPrecachedFile)) {
    hash.update(toPosixPath(file));
    hash.update(
      toPosixPath(file) === "index.html"
        ? hashedIndexHtml
        : await readFile(join(options.distDir, file)),
    );
  }
  const cacheVersion = hash.digest("hex").slice(0, 16);
  const precacheUrls = toPrecacheUrls(files);

  const generated = source
    .replace("__CACHE_VERSION__", cacheVersion)
    .replace("__PRECACHE_URLS__", JSON.stringify(precacheUrls, null, 2));

  await writeFile(join(options.distDir, SERVICE_WORKER_OUTPUT), generated);
  await writeFile(
    join(options.distDir, "index.html"),
    indexHtml.replace(APP_BUILD_META, buildMetaTag(cacheVersion)),
  );
  return { cacheVersion, precacheUrls };
}

/** Lists every file in the output directory as a path relative to it. */
export async function listBuildFiles(distDir: string): Promise<string[]> {
  return walkFiles(distDir, distDir).then((files) => files.sort());
}

async function walkFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(relative(root, path));
    }
  }
  return files;
}

/**
 * Vite plugin that writes `sw.js` after every production build. It runs in
 * `closeBundle` so the precache list sees the final output, including public
 * files. Source maps and host files are filtered out.
 */
export function pwaPlugin(): Plugin {
  let root = "";
  let outDir = "";

  return {
    name: "killingit-pwa",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await buildServiceWorker({
        distDir: outDir,
        sourceFile: resolve(root, SERVICE_WORKER_SOURCE),
      });
    },
  };
}

function toPosixPath(file: string): string {
  return file.split(sep).join("/").replace(/^\.\//, "");
}

function buildMetaTag(buildId: string): string {
  return `<meta name="${APP_BUILD_META_NAME}" content="${buildId}" />`;
}
