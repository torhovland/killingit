import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FoodEntry } from "@killingit/shared";
import { FoodEntryCard } from "./FoodEntryCard";
import { TimeZoneProvider } from "./TimeZoneContext";

const entry: FoodEntry = {
  id: 7,
  eatenAt: "2026-11-07T11:30:00Z",
  eatenDate: "2026-11-07",
  description: "Porridge with berries",
  hasPhoto: false,
  analysis: {
    meal: "A bowl of porridge with a handful of berries",
    carbsGrams: 62.4,
    proteinGrams: 18.2,
    fatGrams: 9.1,
    caloriesKcal: 410.4,
    dietFit:
      "Good fuelling before a long ride.\n\n- Plenty of carbs\n- Add a little protein",
  },
  analysisError: null,
};

function render(value: FoodEntry): string {
  return renderToStaticMarkup(
    <TimeZoneProvider timeZone="Europe/Oslo">
      <FoodEntryCard entry={value} />
    </TimeZoneProvider>,
  );
}

describe("FoodEntryCard", () => {
  it("shows the meal, the coach's description and the macro estimates", () => {
    const html = render(entry);

    expect(html).toContain("Porridge with berries");
    expect(html).toContain("A bowl of porridge with a handful of berries");
    expect(html).toContain("Carbs");
    expect(html).toContain("62 g");
    expect(html).toContain("18 g");
    expect(html).toContain("9 g");
    expect(html).toContain("410 kcal");
    expect(html).toContain("Good fuelling before a long ride.");
    expect(html).toContain("<li>Plenty of carbs</li>");
    // The time is shown in the athlete's display zone.
    expect(html).toContain("12:30");
  });

  it("explains a meal the coach could not analyse", () => {
    const html = render({
      ...entry,
      analysis: null,
      analysisError: "No model is configured.",
    });

    expect(html).toContain("The coach could not analyse this meal");
    expect(html).toContain("No model is configured.");
    expect(html).not.toContain("Carbs");
  });

  it("handles a meal logged from a photo with no description", () => {
    const html = render({ ...entry, description: null, hasPhoto: true });

    expect(html).toContain("Logged from a photo.");
    expect(html).not.toContain("null");
    expect(html).toContain("A bowl of porridge with a handful of berries");
  });

  it("does not render an image element for a meal without a photo", () => {
    expect(render(entry)).not.toContain("<img");
  });
});
