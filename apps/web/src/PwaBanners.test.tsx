import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PwaBanners } from "./PwaBanners";

describe("PwaBanners", () => {
  it("renders nothing while online and up to date", () => {
    const html = renderToStaticMarkup(
      <PwaBanners offline={false} updateReady={false} onReload={() => {}} />,
    );

    expect(html).toBe("");
  });

  it("explains what stays available offline", () => {
    const html = renderToStaticMarkup(
      <PwaBanners offline updateReady={false} onReload={() => {}} />,
    );

    expect(html).toContain("offline.");
    expect(html).toContain("last activities");
    expect(html).toContain('data-testid="offline-banner"');
  });

  it("offers a reload when a new version is waiting", () => {
    const html = renderToStaticMarkup(
      <PwaBanners offline={false} updateReady onReload={() => {}} />,
    );

    expect(html).toContain("A new version of Killing It is ready.");
    expect(html).toContain("Reload");
    expect(html).toContain('data-testid="update-banner"');
  });
});
