import { describe, expect, it } from "bun:test";
import {
  FORM_INTERPRETATION_LABELS,
  FORM_ZONES,
  interpretTrainingStressBalance,
  trainingLoadSchema,
} from "./trainingLoad.js";

describe("trainingLoadSchema", () => {
  it("accepts a day's stress and fitness snapshot", () => {
    expect(
      trainingLoadSchema.parse({ tss: 60, atl: 8.6, ctl: 1.4, tsb: -7.2 }),
    ).toEqual({ tss: 60, atl: 8.6, ctl: 1.4, tsb: -7.2 });
  });

  it("rejects a negative stress or fitness value", () => {
    expect(
      trainingLoadSchema.safeParse({ tss: -1, atl: 0, ctl: 0, tsb: 0 }).success,
    ).toBe(false);
  });
});

describe("interpretTrainingStressBalance", () => {
  it("maps the TSB zones to readable interpretations", () => {
    expect(interpretTrainingStressBalance(26)).toBe("detraining");
    expect(interpretTrainingStressBalance(25)).toBe("fresh");
    expect(interpretTrainingStressBalance(5)).toBe("fresh");
    expect(interpretTrainingStressBalance(4)).toBe("maintaining");
    expect(interpretTrainingStressBalance(-10)).toBe("maintaining");
    expect(interpretTrainingStressBalance(-11)).toBe("productive");
    expect(interpretTrainingStressBalance(-30)).toBe("productive");
    expect(interpretTrainingStressBalance(-31)).toBe("risk");
  });

  it("shades the chart with the same bands as the interpretation", () => {
    expect(FORM_ZONES.map((zone) => zone.interpretation)).toEqual([
      "risk",
      "productive",
      "maintaining",
      "fresh",
      "detraining",
    ]);
    expect(
      FORM_INTERPRETATION_LABELS[interpretTrainingStressBalance(-40)],
    ).toBe("Risk");
  });
});
