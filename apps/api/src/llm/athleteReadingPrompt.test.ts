import { describe, expect, it } from "bun:test";
import {
  buildAthleteReadingMessages,
  type AthleteReadingSource,
} from "./athleteReadingPrompt.js";
import { GLOBAL_PROMPT_RULES } from "./promptRules.js";

const source: AthleteReadingSource = {
  profile: [
    {
      prompt: "What are you training for?",
      answer: "The Oslo Marathon on 14 March 2027. I am 89,5 kg and 24,5 %.",
      skipped: false,
      answeredAt: "2026-11-01T09:00:00Z",
    },
  ],
  profileSavedAt: "2026-11-01",
  entries: [
    {
      date: "2026-10-30",
      label: "activity comment",
      text: "Training camp from 2 to 5 November. Weighed 88.4 kg.",
    },
  ],
  today: "2026-11-04",
};

function systemPrompt(): string {
  return buildAthleteReadingMessages(source)[0]?.content ?? "";
}

/** The user message the app sends for one athlete reading. */
function userPrompt(readSource: AthleteReadingSource = source): string {
  return buildAthleteReadingMessages(readSource)[1]?.content ?? "";
}

describe("athlete reading prompt", () => {
  it("asks for both measurements and dated events in one contract", () => {
    const system = systemPrompt();

    expect(system).toContain(GLOBAL_PROMPT_RULES);
    expect(system).toContain("the measurements they state about themselves");
    expect(system).toContain("every dated goal or event they state");
    expect(system).toContain("never turn a goal into a measurement");
    expect(system).toContain("typical best");
    expect(system).toContain('"statements"');
    expect(system).toContain('"weightKg"');
    expect(system).toContain('"bodyFatPercent"');
    expect(system).toContain('"events"');
    expect(system).toContain('"startDate"');
    expect(system).toContain('"endDate"');
    expect(system).toContain('"coachQuestion"');
  });

  it("dates the profile, the statements and today", () => {
    const prompt = userPrompt();

    expect(prompt).toContain("Today's date: 2026-11-04");
    expect(prompt).toContain(
      "Athlete profile (answers last saved 2026-11-01):",
    );
    expect(prompt).toContain("The Oslo Marathon");
    expect(prompt).toContain(
      "- 2026-10-30 (activity comment): Training camp from 2 to 5 November. Weighed 88.4 kg.",
    );
    expect(prompt).toContain("Report nothing without a date");
  });

  it("sends the system prompt and the athlete's text", () => {
    const messages = buildAthleteReadingMessages(source);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain(GLOBAL_PROMPT_RULES);
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Oslo Marathon");
  });

  it("says so when the athlete wrote nothing else", () => {
    const prompt = userPrompt({
      profile: [],
      profileSavedAt: null,
      entries: [],
      today: "2026-11-04",
    });

    expect(prompt).toContain("Athlete profile:");
    expect(prompt).toContain(
      "The athlete has written no comments, notes, or manual entries.",
    );
  });
});
