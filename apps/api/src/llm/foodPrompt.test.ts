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
});
