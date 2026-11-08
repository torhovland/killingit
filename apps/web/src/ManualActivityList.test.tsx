import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ManualActivity } from "@killingit/shared";
import { ManualActivityList } from "./ManualActivityList";

const activity: ManualActivity = {
  id: 3,
  startDate: "2026-11-07",
  details: "Indoor climb for 45 minutes",
  coachReply: {
    text: "Good steady session.",
    model: "test-model",
    generatedAt: "2026-11-07T18:00:00.000Z",
  },
  estimatedTss: 40,
  trainingLoad: { tss: 40, atl: 50, ctl: 45, tsb: -5 },
};

describe("ManualActivityList", () => {
  it("renders nothing when no manual activity is saved", () => {
    expect(
      renderToStaticMarkup(
        <ManualActivityList
          activities={[]}
          onEdit={() => {}}
          onDelete={() => Promise.resolve()}
        />,
      ),
    ).toBe("");
  });

  it("renders each saved activity with its coach reply and actions", () => {
    const html = renderToStaticMarkup(
      <ManualActivityList
        activities={[activity]}
        onEdit={() => {}}
        onDelete={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("Saved manual activities");
    expect(html).toContain("2026-11-07");
    expect(html).toContain("Indoor climb for 45 minutes");
    expect(html).toContain("Good steady session.");
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
  });
});
