import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Modal } from "./Modal";

function renderModal(): string {
  return renderToStaticMarkup(
    <Modal
      labelledBy="example-title"
      describedBy="example-description"
      onClose={() => undefined}
      className="max-w-md"
      testId="example-dialog"
    >
      <h3 id="example-title">Delete your account?</h3>
      <p id="example-description">This cannot be undone.</p>
    </Modal>,
  );
}

describe("Modal", () => {
  it("renders an accessible modal dialog around its content", () => {
    const html = renderModal();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="example-title"');
    expect(html).toContain('aria-describedby="example-description"');
    expect(html).toContain('data-testid="example-dialog"');
    expect(html).toContain("Delete your account?");
    expect(html).toContain("This cannot be undone.");
  });

  it("defaults to a click-to-close backdrop", () => {
    const html = renderModal();

    expect(html).toStartWith(
      '<div class="fixed inset-0 z-50 flex items-center justify-center',
    );
    expect(html).toContain('role="presentation"');
  });

  it("lets the caller set the panel width without repeating the surface", () => {
    const html = renderModal();

    expect(html).toContain("w-full rounded-lg border bg-card p-4");
    expect(html).toContain("max-w-md");
  });
});
