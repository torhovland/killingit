import { describe, expect, it } from "bun:test";
import {
  bikePrediction,
  halfMarathonPrediction,
  requiredFtpForTime,
} from "./course.js";

describe("bike course model", () => {
  it("reproduces the athlete's five-year-old 3:20 at FTP 285", () => {
    const prediction = bikePrediction(285);
    expect(prediction.soloSeconds / 60).toBeGreaterThan(195);
    expect(prediction.soloSeconds / 60).toBeLessThan(205);
  });

  it("needs the prior peak for 3:10 solo and less in a group", () => {
    const required = requiredFtpForTime(3 * 60 * 60 + 10 * 60);
    expect(required.solo).toBeGreaterThan(285);
    expect(required.draft).toBeLessThan(285);
    expect(required.draft).toBeGreaterThan(270);
  });
});

describe("half-marathon model", () => {
  it("turns the prior threshold into a sub-two-hour half", () => {
    expect(halfMarathonPrediction(315).seconds).toBeLessThan(2 * 60 * 60);
  });

  it("leaves a slow threshold over two hours", () => {
    expect(halfMarathonPrediction(360).seconds).toBeGreaterThan(2 * 60 * 60);
    expect(halfMarathonPrediction(335).seconds).toBeGreaterThan(2 * 60 * 60);
    expect(halfMarathonPrediction(330).seconds).toBeLessThan(2 * 60 * 60);
  });
});
