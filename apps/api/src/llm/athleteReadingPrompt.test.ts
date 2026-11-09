import { describe, expect, it } from "bun:test";
import {
  ATHLETE_READING_SYSTEM_PROMPT,
  buildAthleteReadingMessages,
  buildAthleteReadingPrompt,
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

describe("athlete reading prompt", () => {
  it("asks for both measurements and dated events in one contract", () => {
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain(GLOBAL_PROMPT_RULES);
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain(
      "the measurements they state about themselves",
    );
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain(
      "every dated goal or event they state",
    );
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain(
      "never turn a goal into a measurement",
    );
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain("typical best");
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain('"statements"');
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain('"weightKg"');
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain('"bodyFatPercent"');
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain('"events"');
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain('"startDate"');
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain('"endDate"');
    expect(ATHLETE_READING_SYSTEM_PROMPT).toContain('"coachQuestion"');
  });

  it("dates the profile, the statements and today", () => {
    const prompt = buildAthleteReadingPrompt(source);

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
    expect(messages[0]?.content).toBe(ATHLETE_READING_SYSTEM_PROMPT);
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Oslo Marathon");
  });

  it("says so when the athlete wrote nothing else", () => {
    const prompt = buildAthleteReadingPrompt({
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
