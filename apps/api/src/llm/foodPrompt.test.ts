import { describe, expect, it } from "bun:test";
import { DIET_RULES } from "./promptRules.js";
import {
  buildFoodAnalysisMessages,
  type FoodAnalysisInput,
} from "./foodPrompt.js";

const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

function input(overrides: Partial<FoodAnalysisInput> = {}): FoodAnalysisInput {
  return {
    context: {
      athleteAnswers: [
        { prompt: "Goal", answer: "Run a marathon", skipped: false },
      ],
      recentActivities: [],
      today: "2026-11-07",
    },
    eatenDate: "2026-11-07",
    eatenTime: "12:30",
    description: "A cheese sandwich",
    ...overrides,
  };
}

describe("buildFoodAnalysisMessages", () => {
  it("describes the meal and asks for the structured contract", () => {
    const messages = buildFoodAnalysisMessages(input());
    const system = messages[0]?.content;
    const user = messages[1]?.content;

    expect(typeof system).toBe("string");
    expect(system).toContain(DIET_RULES);
    expect(system).toContain('"carbsGrams": 0');
    expect(typeof user).toBe("string");
    expect(user).toContain("Today's date: 2026-11-07");
    expect(user).toContain('"A cheese sandwich"');
    expect(user).toContain("2026-11-07 12:30");
    expect(user).toContain("No photo was attached.");
  });

  it("asks the coach to identify a photo-only meal", () => {
    const messages = buildFoodAnalysisMessages(
      input({
        description: null,
        photoDataUrl: photo,
      }),
    );
    const user = messages[1]?.content;
    expect(Array.isArray(user)).toBe(true);
    expect(JSON.stringify(user)).toContain(
      "The athlete gave no description; identify the meal from the photo.",
    );
  });

  it("attaches the photo as an image part", () => {
    const messages = buildFoodAnalysisMessages(input({ photoDataUrl: photo }));
    const user = messages[1]?.content;

    expect(Array.isArray(user)).toBe(true);
    if (!Array.isArray(user)) {
      throw new Error("expected a multimodal message");
    }
    expect(user[0]).toMatchObject({ type: "text" });
    expect(user[1]).toEqual({
      type: "image_url",
      image_url: { url: photo },
    });
    expect(JSON.stringify(user)).toContain("A photo of the meal is attached.");
  });

  it("drops the photo when a text-only retry is requested", () => {
    const messages = buildFoodAnalysisMessages(
      input({ photoDataUrl: photo }),
      false,
    );
    expect(typeof messages[1]?.content).toBe("string");
    expect(messages[1]?.content).toContain("No photo was attached.");
  });

  it("shows the previous description and assessment for a re-assessment", () => {
    const messages = buildFoodAnalysisMessages(
      input({
        description: "Toast with peanut butter and a banana",
        previous: {
          description: "Two slices of toast",
          analysis: {
            meal: "Two slices of toast with butter",
            carbsGrams: 40,
            proteinGrams: 8,
            fatGrams: 12,
            caloriesKcal: 300,
            dietFit: "Fine as a snack before an easy run.",
          },
        },
      }),
    );
    const system = messages[0]?.content;
    const user = messages[1]?.content;

    expect(typeof system).toBe("string");
    expect(system).toContain("This is a re-assessment");
    expect(typeof user).toBe("string");
    expect(user).toContain('Previous description: "Two slices of toast"');
    expect(user).toContain("Meal: Two slices of toast with butter");
    expect(user).toContain(
      "Carbs: 40 g; protein: 8 g; fat: 12 g; energy: 300 kcal",
    );
    expect(user).toContain("Diet fit: Fine as a snack before an easy run.");
    expect(user).toContain("The meal now reads:");
    expect(user).toContain('"Toast with peanut butter and a banana"');
    expect(user).toContain("Compare the two versions");
  });

  it("still re-assesses a meal that was never analysed", () => {
    const messages = buildFoodAnalysisMessages(
      input({
        previous: { description: "Two slices of toast", analysis: null },
      }),
    );
    const user = messages[1]?.content;
    expect(typeof user).toBe("string");
    expect(user).toContain('Previous description: "Two slices of toast"');
    expect(user).toContain(
      "Previous assessment: none; this meal has not been analysed.",
    );
  });
});
