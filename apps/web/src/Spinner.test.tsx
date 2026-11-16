import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("merges the caller's classes with the spinner's base classes", () => {
    const html = renderToStaticMarkup(
      <Spinner className="size-6 border-0 text-primary" label="Updating" />,
    );

    expect(html).toContain("animate-spin");
    expect(html).toContain("size-6");
    expect(html).toContain("text-primary");
    // tailwind-merge drops the base border width the caller overrides.
    expect(html).not.toContain("border-2");
  });

  it("labels a standalone spinner", () => {
    const html = renderToStaticMarkup(<Spinner label="Updating the plan" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Updating the plan"');
    expect(html).toContain('title="Updating the plan"');
    expect(html).toContain("size-4");
    expect(html).toContain('data-testid="spinner"');
  });

  it("hides an unlabelled spinner from assistive technology", () => {
    const html = renderToStaticMarkup(<Spinner />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("aria-label");
    expect(html).toContain("size-4");
  });
});
