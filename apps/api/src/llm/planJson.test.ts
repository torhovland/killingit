import { describe, expect, it } from "bun:test";
import { dayPlanSchema } from "@killingit/shared";
import { parsePlanJson, PlanJsonError } from "./planJson.js";

const validDay = {
  date: "2026-10-21",
  type: "workout",
  title: "Easy run",
  description: "45 minutes easy.",
  durationMinutes: 45,
  intensity: "easy",
  rationale: "Easy aerobic work.",
};

describe("parsePlanJson", () => {
  it("parses raw JSON", () => {
    const parsed = parsePlanJson(dayPlanSchema, JSON.stringify(validDay));
    expect(parsed.title).toBe("Easy run");
    expect(parsed.alternatives).toEqual([]);
  });

  it("parses JSON in a markdown fence", () => {
    const text = `\`\`\`json\n${JSON.stringify(validDay)}\n\`\`\``;
    expect(parsePlanJson(dayPlanSchema, text).title).toBe("Easy run");
  });

  it("ignores prose around the JSON object", () => {
    const text = `Here is your plan:\n${JSON.stringify(validDay)}\nEnjoy!`;
    expect(parsePlanJson(dayPlanSchema, text).durationMinutes).toBe(45);
  });

  it("rejects invalid JSON", () => {
    expect(() => parsePlanJson(dayPlanSchema, "not json")).toThrow(
      PlanJsonError,
    );
  });

  it("rejects JSON with the wrong shape", () => {
    expect(() =>
      parsePlanJson(dayPlanSchema, JSON.stringify({ title: "No date" })),
    ).toThrow(PlanJsonError);
  });
});
