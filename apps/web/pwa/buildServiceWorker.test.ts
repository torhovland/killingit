import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildServiceWorker,
  isPrecachedFile,
  listBuildFiles,
  toPrecacheUrls,
} from "./buildServiceWorker";

const sourceFile = join(import.meta.dir, "service-worker.js");
const tempDirs: string[] = [];

async function makeDist(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "killingit-pwa-"));
  tempDirs.push(dir);
  await mkdir(join(dir, "assets"), { recursive: true });
  await mkdir(join(dir, "fonts"), { recursive: true });
  await writeFile(join(dir, "index.html"), "<!doctype html><title>App</title>");
  await writeFile(
    join(dir, "offline.html"),
    "<!doctype html><title>Offline</title>",
  );
  await writeFile(join(dir, "manifest.webmanifest"), "{}");
  await writeFile(join(dir, "assets", "app-a1b2c3.js"), "console.log(1);\n");
  await writeFile(join(dir, "assets", "app-a1b2c3.js.map"), "{}");
  await writeFile(join(dir, "fonts", "space.woff2"), "font");
  await writeFile(join(dir, "_headers"), "/*\n  Cache-Control: no-cache\n");
  await writeFile(join(dir, "_redirects"), "/* /index.html 200\n");
  await writeFile(join(dir, "sw.js"), "old worker");
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

describe("toPrecacheUrls", () => {
  it("adds the root and keeps the app shell, public files, and assets", () => {
    expect(
      toPrecacheUrls(["assets/app.js", "fonts/font.woff2", "index.html"]),
    ).toEqual(["/", "/assets/app.js", "/fonts/font.woff2", "/index.html"]);
  });

  it("drops host files, source maps, and the worker itself", () => {
    expect(isPrecachedFile("_headers")).toBe(false);
    expect(isPrecachedFile("_redirects")).toBe(false);
    expect(isPrecachedFile("assets/app.js.map")).toBe(false);
    expect(isPrecachedFile("sw.js")).toBe(false);
    expect(isPrecachedFile("assets/app.js")).toBe(true);
  });
});

describe("buildServiceWorker", () => {
  it("writes a worker whose precache list is the finished static build", async () => {
    const distDir = await makeDist();

    const result = await buildServiceWorker({ distDir, sourceFile });
    const generated = await readFile(join(distDir, "sw.js"), "utf8");

    expect(result.precacheUrls).toEqual([
      "/",
      "/assets/app-a1b2c3.js",
      "/fonts/space.woff2",
      "/index.html",
      "/manifest.webmanifest",
      "/offline.html",
    ]);
    expect(generated).toContain(
      `const CACHE_VERSION = "${result.cacheVersion}";`,
    );
    expect(generated).toContain('"/assets/app-a1b2c3.js"');
    expect(generated).not.toContain('"/assets/app-a1b2c3.js.map"');
    expect(generated).not.toContain('"/_headers"');
    expect(generated).not.toContain('"/_redirects"');
    expect(generated).not.toContain('"/sw.js"');
    expect(generated).not.toContain("__PRECACHE_URLS__");
    expect(generated).not.toContain("__CACHE_VERSION__");
    expect(generated).toContain('event.data?.type === "SKIP_WAITING"');
    expect(generated).toContain('url.pathname.startsWith("/api/")');
    expect(generated).toContain('contentType.includes("text/html")');
  });

  it("changes the cache version when a precached file changes", async () => {
    const distDir = await makeDist();
    const first = await buildServiceWorker({ distDir, sourceFile });

    await writeFile(
      join(distDir, "assets", "app-a1b2c3.js"),
      "console.log(2);\n",
    );
    const second = await buildServiceWorker({ distDir, sourceFile });

    expect(second.cacheVersion).not.toBe(first.cacheVersion);
  });

  it("keeps the cache version stable when only the previous worker changes", async () => {
    const distDir = await makeDist();
    const first = await buildServiceWorker({ distDir, sourceFile });

    await writeFile(join(distDir, "sw.js"), "an older generated worker");
    const second = await buildServiceWorker({ distDir, sourceFile });

    expect(second.cacheVersion).toBe(first.cacheVersion);
  });

  it("refuses to build without the app shell or offline page", async () => {
    const distDir = await makeDist();
    await rm(join(distDir, "offline.html"));

    let failure: unknown;
    try {
      await buildServiceWorker({ distDir, sourceFile });
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("dist/offline.html");
  });

  it("lists files relative to the output directory in a stable order", async () => {
    const distDir = await makeDist();

    expect(await listBuildFiles(distDir)).toContain("assets/app-a1b2c3.js");
    expect(await listBuildFiles(distDir)).toEqual(
      [...(await listBuildFiles(distDir))].sort(),
    );
  });
});
