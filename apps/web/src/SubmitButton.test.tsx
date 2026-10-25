import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmitButton } from "./SubmitButton";

describe("SubmitButton", () => {
  it("shows a spinner and disables itself while busy", () => {
    const html = renderToStaticMarkup(
      <SubmitButton busy>Save comment</SubmitButton>,
    );

    expect(html).toContain('data-testid="spinner"');
    expect(html).toContain("animate-spin");
    expect(html).toContain("disabled");
    expect(html).toContain("Save comment");
  });

  it("renders only its label when idle", () => {
    const html = renderToStaticMarkup(
      <SubmitButton busy={false}>Save comment</SubmitButton>,
    );

    expect(html).not.toContain('data-testid="spinner"');
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("disabled");
    expect(html).toContain("Save comment");
  });
});
