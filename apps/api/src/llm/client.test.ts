import { describe, expect, it } from "bun:test";
import { modelChoiceMessage } from "./modelChoice.js";

describe("modelChoiceMessage", () => {
  it("names the role and the Settings fix for a retired model", () => {
    expect(modelChoiceMessage("openai/old", "season", "retired")).toBe(
      "Your season planning model openai/old is retired. Open Settings and choose another model.",
    );
  });

  it("directs a deleted model to Settings as well", () => {
    expect(modelChoiceMessage("openai/gone", "daily", "missing")).toBe(
      "Your day-to-day model openai/gone is no longer available. Open Settings and choose another model.",
    );
  });
});
