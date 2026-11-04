import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InstallAppButton, PwaInstallSection } from "./PwaInstall";

describe("InstallAppButton", () => {
  it("is hidden unless the browser offers installation", () => {
    const html = renderToStaticMarkup(
      <InstallAppButton installable={false} onInstall={() => {}} />,
    );

    expect(html).toBe("");
  });

  it("shows the install action when available", () => {
    const html = renderToStaticMarkup(
      <InstallAppButton installable onInstall={() => {}} />,
    );

    expect(html).toContain("Install app");
    expect(html).toContain('data-testid="install-app-button"');
  });
});

describe("PwaInstallSection", () => {
  it("confirms an installed app", () => {
    const html = renderToStaticMarkup(
      <PwaInstallSection installed installable={false} onInstall={() => {}} />,
    );

    expect(html).toContain("installed on this device");
    expect(html).not.toContain("install-app-section-button");
  });

  it("offers the install action from settings", () => {
    const html = renderToStaticMarkup(
      <PwaInstallSection installed={false} installable onInstall={() => {}} />,
    );

    expect(html).toContain("Install Killing It");
    expect(html).toContain('data-testid="install-app-section-button"');
  });

  it("explains the browser action when no prompt is available", () => {
    const html = renderToStaticMarkup(
      <PwaInstallSection
        installed={false}
        installable={false}
        onInstall={() => {}}
      />,
    );

    expect(html).toContain("Add to Home Screen");
    expect(html).not.toContain("install-app-section-button");
  });
});
