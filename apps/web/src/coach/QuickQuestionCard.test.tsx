import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickQuestionCard } from "./QuickQuestionCard";

function render(
  overrides: Partial<Parameters<typeof QuickQuestionCard>[0]> = {},
): string {
  return renderToStaticMarkup(
    <QuickQuestionCard
      question=""
      reply={null}
      asking={false}
      error={null}
      onQuestionChange={() => {}}
      onAsk={() => {}}
      {...overrides}
    />,
  );
}

describe("QuickQuestionCard", () => {
  it("renders the by-the-way form", () => {
    const html = render();

    expect(html).toContain('for="by-the-way"');
    expect(html).toContain("By the way");
    expect(html).toContain("Ask the coach");
    expect(html).toContain("do not influence your training plan");
  });

  it("shows the coach's answer", () => {
    const html = render({
      question: "Should I run on Saturday?",
      reply: "Run on Saturday and keep Sunday easy.",
    });

    expect(html).toContain("Should I run on Saturday?");
    expect(html).toContain("Run on Saturday and keep Sunday easy.");
    expect(html).toContain('data-testid="by-the-way-reply"');
  });

  it("shows an error and a busy label", () => {
    const html = render({ asking: true, error: "The coach is unavailable" });

    expect(html).toContain("The coach is unavailable");
    expect(html).toContain("Coach is thinking…");
  });
});
