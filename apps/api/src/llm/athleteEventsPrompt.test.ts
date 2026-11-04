import { describe, expect, it } from "bun:test";
import {
  ATHLETE_EVENTS_SYSTEM_PROMPT,
  buildAthleteEventsMessages,
  buildAthleteEventsPrompt,
} from "./athleteEventsPrompt.js";

const source = {
  profile: [
    {
      prompt: "What are you training for?",
      answer: "The Oslo Marathon on 14 March 2027.",
      skipped: false,
      answeredAt: "2026-11-01T09:00:00Z",
    },
  ],
  profileSavedAt: "2026-11-01",
  entries: [
    {
      date: "2026-10-30",
      label: "activity comment",
      text: "Training camp from 2 to 5 November.",
    },
  ],
  today: "2026-11-04",
};

describe("athlete events prompt", () => {
  it("states the shape of a dated event", () => {
    expect(ATHLETE_EVENTS_SYSTEM_PROMPT).toContain('"startDate"');
    expect(ATHLETE_EVENTS_SYSTEM_PROMPT).toContain('"endDate"');
    expect(ATHLETE_EVENTS_SYSTEM_PROMPT).toContain('"title"');
    expect(ATHLETE_EVENTS_SYSTEM_PROMPT).toContain('"kind"');
    expect(ATHLETE_EVENTS_SYSTEM_PROMPT).toContain("race");
    expect(ATHLETE_EVENTS_SYSTEM_PROMPT).toContain("trip");
    expect(ATHLETE_EVENTS_SYSTEM_PROMPT).toContain('"coachQuestion"');
  });

  it("anchors relative dates to today and lists every athlete statement", () => {
    const prompt = buildAthleteEventsPrompt(source);

    expect(prompt).toContain("Today's date: 2026-11-04");
    expect(prompt).toContain(
      "Athlete profile (answers last saved 2026-11-01):",
    );
    expect(prompt).toContain("What are you training for?: The Oslo Marathon");
    expect(prompt).toContain(
      "2026-10-30 (activity comment): Training camp from 2 to 5 November.",
    );
    expect(prompt).toContain("Report nothing without a date");
  });

  it("sends the system prompt and the athlete's text", () => {
    const messages = buildAthleteEventsMessages(source);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe(ATHLETE_EVENTS_SYSTEM_PROMPT);
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Oslo Marathon");
  });
});
