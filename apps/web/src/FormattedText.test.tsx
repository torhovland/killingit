import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FormattedText } from "./FormattedText";

describe("FormattedText", () => {
  it("renders a single paragraph", () => {
    const html = renderToStaticMarkup(
      <FormattedText text="Easy aerobic work." />,
    );

    expect(html).toContain("<p>Easy aerobic work.</p>");
  });

  it("separates paragraphs on blank lines", () => {
    const html = renderToStaticMarkup(
      <FormattedText text={"First paragraph.\n\nSecond paragraph."} />,
    );

    expect(html).toContain("<p>First paragraph.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
  });

  it("joins wrapped paragraph lines with a space", () => {
    const html = renderToStaticMarkup(
      <FormattedText text={"One long\nparagraph."} />,
    );

    expect(html).toContain("<p>One long paragraph.</p>");
  });

  it("renders bullet lines as an unordered list", () => {
    const html = renderToStaticMarkup(
      <FormattedText text={"Main set:\n- Ten minutes easy\n- Four repeats"} />,
    );

    expect(html).toContain("<p>Main set:</p>");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>Ten minutes easy</li>");
    expect(html).toContain("<li>Four repeats</li>");
  });

  it("keeps one list when blank lines separate its items", () => {
    const html = renderToStaticMarkup(
      <FormattedText text={"- One\n\n- Two"} />,
    );

    expect(html.match(/<ul/g)?.length).toBe(1);
    expect(html).toContain("<li>One</li>");
    expect(html).toContain("<li>Two</li>");
  });

  it("renders numbered lines as an ordered list", () => {
    const html = renderToStaticMarkup(
      <FormattedText
        text={"Do this:\n1. Warm up\n2. Run hard\n3) Cool down"}
      />,
    );

    expect(html).toContain("<ol");
    expect(html).toContain("<li>Warm up</li>");
    expect(html).toContain("<li>Run hard</li>");
    expect(html).toContain("<li>Cool down</li>");
  });

  it("keeps the first number of an ordered list", () => {
    const html = renderToStaticMarkup(
      <FormattedText text={"3. Start here\n4. Continue"} />,
    );

    expect(html).toContain('start="3"');
  });

  it("splits a paragraph and a list when no blank line separates them", () => {
    const html = renderToStaticMarkup(
      <FormattedText text={"Main set:\n- Ten minutes easy\n- Four repeats"} />,
    );

    expect(html).toContain("<p>Main set:</p>");
    expect(html).toContain("<ul");
  });

  it("renders inline bold as strong", () => {
    const html = renderToStaticMarkup(
      <FormattedText text={"- **Warm-up:** ten minutes"} />,
    );

    expect(html).toContain("<strong>Warm-up:</strong> ten minutes");
  });

  it("escapes HTML in the text", () => {
    const html = renderToStaticMarkup(
      <FormattedText text={"<script>alert('no')</script>"} />,
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders nothing for empty or whitespace-only text", () => {
    expect(renderToStaticMarkup(<FormattedText text="" />)).toBe("");
    expect(renderToStaticMarkup(<FormattedText text={"  \n\n  "} />)).toBe("");
  });

  it("keeps the test id and class name on the wrapper", () => {
    const html = renderToStaticMarkup(
      <FormattedText
        text="Easy work."
        className="text-muted-foreground"
        testId="analysis"
      />,
    );

    expect(html).toContain('data-testid="analysis"');
    expect(html).toContain("text-muted-foreground");
  });
});
