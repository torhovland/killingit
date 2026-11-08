import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WeeklyNoteCard } from "./WeeklyNoteCard";

function render(
  overrides: Partial<Parameters<typeof WeeklyNoteCard>[0]> = {},
): string {
  return renderToStaticMarkup(
    <WeeklyNoteCard
      note=""
      reply={null}
      saving={false}
      error={null}
      onNoteChange={() => {}}
      onSend={() => {}}
      {...overrides}
    />,
  );
}

describe("WeeklyNoteCard", () => {
  it("renders the weekly note form", () => {
    const html = render();

    expect(html).toContain('for="weekly-note"');
    expect(html).toContain("Weekly note");
    expect(html).toContain("Send to coach");
    expect(html).toContain("refreshes the affected plan");
  });

  it("shows the coach's reply", () => {
    const html = render({
      note: "I cannot train on Thursday.",
      reply: {
        text: "Understood. Thursday is now a rest day.",
        model: "test-model",
        generatedAt: "2026-11-08T09:00:00.000Z",
      },
    });

    expect(html).toContain("I cannot train on Thursday.");
    expect(html).toContain("Understood. Thursday is now a rest day.");
    expect(html).toContain('data-testid="weekly-note-reply"');
  });

  it("shows an error and a busy label", () => {
    const html = render({ saving: true, error: "Could not reach the coach" });

    expect(html).toContain("Could not reach the coach");
    expect(html).toContain("Coach is thinking…");
  });
});
