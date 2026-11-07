import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FoodEntry } from "@killingit/shared";
import { AppStatusProvider } from "./AppStatus";
import { EditFoodEntryForm } from "./EditFoodEntryForm";
import { TimeZoneProvider } from "./TimeZoneContext";

const entry: FoodEntry = {
  id: 7,
  eatenAt: "2026-11-07T11:30:00Z",
  eatenDate: "2026-11-07",
  description: "Porridge with berries",
  hasPhoto: false,
  analysis: null,
  analysisError: null,
  updatedAt: "2026-11-07T11:30:00Z",
};

function render(value: FoodEntry): string {
  return renderToStaticMarkup(
    <AppStatusProvider>
      <TimeZoneProvider timeZone="Europe/Oslo">
        <EditFoodEntryForm
          entry={value}
          onSaved={() => undefined}
          onCancel={() => undefined}
        />
      </TimeZoneProvider>
    </AppStatusProvider>,
  );
}

describe("EditFoodEntryForm", () => {
  it("prefills the meal's description and local time", () => {
    const html = render(entry);

    expect(html).toContain("Edit this meal");
    expect(html).toContain("Porridge with berries");
    expect(html).toContain('value="2026-11-07T12:30"');
    expect(html).toContain("Save and re-assess");
    expect(html).toContain("asks your coach to analyse the meal again");
  });

  it("offers to keep or remove an existing photo", () => {
    const html = render({ ...entry, hasPhoto: true });

    expect(html).toContain("Remove photo");
    expect(html).not.toContain("No photo attached.");
  });

  it("offers a camera and an upload for a replacement photo", () => {
    const html = render(entry);

    expect(html).toContain("Take photo");
    expect(html).toContain("Upload image");
    expect(html).toContain("No photo attached.");
  });
});
