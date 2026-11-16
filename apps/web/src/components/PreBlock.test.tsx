import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PreBlock } from "./PreBlock";

describe("PreBlock", () => {
  it("renders preformatted text on an inset surface", () => {
    const html = renderToStaticMarkup(
      <PreBlock>{"line one\nline two"}</PreBlock>,
    );

    expect(html).toStartWith("<pre");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("break-words");
    expect(html).toContain("bg-inset");
    expect(html).not.toContain("text-destructive");
    expect(html).toContain("line one\nline two");
  });

  it("shows an error in the destructive tone", () => {
    const html = renderToStaticMarkup(
      <PreBlock tone="destructive">Provider rate limit</PreBlock>,
    );

    expect(html).toContain("text-destructive");
    expect(html).toContain("Provider rate limit");
  });

  it("lets the caller add spacing without repeating the base classes", () => {
    const html = renderToStaticMarkup(
      <PreBlock className="mt-2">{`{}`}</PreBlock>,
    );

    expect(html).toContain("mt-2");
    expect(html).toContain("whitespace-pre-wrap");
  });
});
