import { describe, expect, it, spyOn } from "bun:test";
import type { Activity, AnalyzedActivity } from "@killingit/shared";
import { LlmModelChoiceError } from "../../llm/client.js";
import { LlmAuthError, LlmProviderError } from "../../llm/openrouter.js";
import type { ActivityFeedback } from "../../plans/replies.js";
import { withActivityFeedback } from "../activityStore.js";
import { failedAnalysis, withActivityLoad } from "./presenter.js";

function synced(id: number, startDate: string, name: string): Activity {
  return {
    id,
    name,
    type: "cycling",
    startDate,
    distance: 10000,
    movingTime: 1800,
    elapsedTime: 1900,
    totalElevationGain: 100,
    samples: [],
  };
}

function stored(id: number, startDate: string): AnalyzedActivity {
  return {
    ...synced(id, startDate, `Old ${id}`),
    sampleCount: 0,
    analysis: {
      text: `Analysis ${id}`,
      model: "test-model",
      generatedAt: "2026-10-01T07:00:00Z",
    },
    analysisError: null,
    programAnalysis: null,
    comment: `Comment ${id}`,
    coachReply: null,
  };
}

describe("withActivityFeedback", () => {
  const feedback: ActivityFeedback = {
    comment: "Felt strong",
    commentUpdatedAt: new Date("2026-10-03T08:00:00Z"),
    reply: {
      kind: "activity_comment",
      target: "1",
      text: "Good ride",
      model: "test-model",
      generatedAt: new Date("2026-10-03T09:00:00Z"),
      planChangeNeeded: false,
    },
    reviewed: true,
  };

  it("applies the stored comment, reply and reviewed flag", () => {
    const updated = withActivityFeedback(
      stored(1, "2026-10-03T06:30:00Z"),
      new Map([["1", feedback]]),
    );

    expect(updated.comment).toBe("Felt strong");
    expect(updated.coachReply?.text).toBe("Good ride");
    expect(updated.reviewed).toBe(true);
  });

  it("returns the activity unchanged when it has no stored feedback", () => {
    const activity = stored(1, "2026-10-03T06:30:00Z");

    expect(withActivityFeedback(activity, new Map())).toBe(activity);
  });
});

describe("failedAnalysis", () => {
  it("shows a provider message the athlete can act on", () => {
    const shown = failedAnalysis(
      synced(1, "2026-10-03T06:30:00Z", "Ride"),
      new LlmAuthError("invalid OpenRouter API key"),
      null,
      undefined,
    );

    expect(shown.analysisError).toBe("invalid OpenRouter API key");
  });

  it("shows a retired-model message", () => {
    const shown = failedAnalysis(
      synced(1, "2026-10-03T06:30:00Z", "Ride"),
      new LlmModelChoiceError("Your daily model is retired."),
      null,
      undefined,
    );

    expect(shown.analysisError).toBe("Your daily model is retired.");
  });

  it("keeps an internal message out of the card and in the log", () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const shown = failedAnalysis(
        synced(1, "2026-10-03T06:30:00Z", "Ride"),
        new Error("relation activities does not exist"),
        null,
        undefined,
      );

      expect(shown.analysisError).toBe(
        "The coach analysis could not be saved.",
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[1])).toContain(
        "relation activities does not exist",
      );
    } finally {
      log.mockRestore();
    }
  });

  it("keeps a provider service failure's message", () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const shown = failedAnalysis(
        synced(1, "2026-10-03T06:30:00Z", "Ride"),
        new LlmProviderError("OpenRouter returned an empty completion"),
        null,
        undefined,
      );

      expect(shown.analysisError).toBe(
        "OpenRouter returned an empty completion",
      );
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});

describe("withActivityLoad", () => {
  const loads = {
    byDate: new Map([["2026-10-03", { tss: 85, atl: 29, ctl: 20, tsb: -20 }]]),
    byActivityId: new Map([[1, 40]]),
  };

  it("attaches the activity's own TSS and its day's fitness snapshot", () => {
    const updated = withActivityLoad(
      stored(1, "2026-10-03T06:30:00Z"),
      loads,
      "UTC",
    );

    expect(updated.activityTss).toBe(40);
    expect(updated.trainingLoad?.tss).toBe(85);
  });

  it("keeps an existing activity TSS when the loads do not cover it", () => {
    const activity = {
      ...stored(2, "2026-10-04T06:30:00Z"),
      activityTss: 55,
    };

    const updated = withActivityLoad(activity, loads, "UTC");

    expect(updated.activityTss).toBe(55);
    expect(updated.trainingLoad).toBeNull();
  });
});
