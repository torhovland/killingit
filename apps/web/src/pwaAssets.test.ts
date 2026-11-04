import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const publicDir = join(import.meta.dir, "..", "public");
const manifestPath = join(publicDir, "manifest.webmanifest");
const indexHtml = readFileSync(
  join(import.meta.dir, "..", "index.html"),
  "utf8",
);
const headers = readFileSync(join(publicDir, "_headers"), "utf8");

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

interface Manifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  display_override: string[];
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("PWA manifest", () => {
  it("is installable from the site root in standalone mode", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.name).toBe("Killing It");
    expect(manifest.short_name).toBe("Killing It");
    expect(manifest.description).toContain("AI coach");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.display_override).toContain("standalone");
    expect(manifest.background_color).toBe("#1b2c86");
    expect(manifest.theme_color).toBe("#1b2c86");
  });

  it("ships every declared icon at the declared size", () => {
    for (const icon of manifest.icons) {
      const path = join(publicDir, icon.src.replace(/^\//, ""));
      expect(existsSync(path)).toBe(true);
      if (icon.type === "image/png") {
        const size = pngSize(path);
        expect(`${size.width}x${size.height}`).toBe(icon.sizes);
      }
    }
    expect(
      manifest.icons.some((icon) => icon.purpose.includes("maskable")),
    ).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === "512x512")).toBe(true);
  });
});

describe("PWA shell metadata", () => {
  it("links the manifest and install metadata from index.html", () => {
    expect(indexHtml).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-title"');
    expect(indexHtml).toContain('name="mobile-web-app-capable"');
    expect(indexHtml).toContain("viewport-fit=cover");
    expect(indexHtml).toContain('name="application-name" content="Killing It"');
  });

  it("includes a static offline page", () => {
    const offline = readFileSync(join(publicDir, "offline.html"), "utf8");
    expect(offline).toContain("You're offline");
    expect(offline).toContain('href="/"');
  });

  it("revalidates the generated service worker and manifest", () => {
    for (const pattern of ["/sw.js", "/manifest.webmanifest"]) {
      expect(headers).toContain(pattern);
      const rule = headers.slice(headers.indexOf(pattern));
      expect(rule).toContain("! Cache-Control");
      expect(rule).toContain("Cache-Control: no-cache");
    }
  });
});
