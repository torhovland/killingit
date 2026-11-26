import { describe, expect, it } from "bun:test";
import { makeDay, makePlan, PLAN_TODAY } from "../testFixtures/plan.js";
import { generateCoachReply, type CoachReplyOutcome } from "./coachReply.js";
import type { CoachReplyTarget } from "./coachReplyPrompt.js";
import { readCoachReplyText } from "./coachReplyText.js";
import type { LlmCompletionRequest, LlmProvider } from "./openrouter.js";
import type { PlanContextInput } from "./planContext.js";

class FakeProvider implements LlmProvider {
  readonly id = "fake";
  requests: LlmCompletionRequest[] = [];

  constructor(private readonly response: string) {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    return Promise.resolve(this.response);
  }
}

const credentials = { apiKey: "key", model: "model" };

const context: PlanContextInput = {
  today: PLAN_TODAY,
  athleteAnswers: [],
  recentActivities: [],
};

function reply(
  provider: FakeProvider,
  request: CoachReplyTarget,
  kind: "coach_reply" | "coaching_question" = "coach_reply",
): Promise<CoachReplyOutcome> {
  return generateCoachReply(
    provider,
    credentials,
    { plan: makePlan({ today: makeDay(PLAN_TODAY) }), context, request },
    kind,
  );
}

describe("readCoachReplyText", () => {
  it("strips a trailing envelope and keeps its scope", () => {
    expect(
      readCoachReplyText(
        'Good work, keep Thursday easy. {"planChangeScope":"day"}',
      ),
    ).toEqual({
      text: "Good work, keep Thursday easy.",
      planChangeScope: "day",
      planChangeNeeded: undefined,
    });
  });

  it("reads the reply from the JSON contract", () => {
    expect(
      readCoachReplyText('{"reply":"Nice session.","planChangeScope":"week"}'),
    ).toEqual({
      text: "Nice session.",
      planChangeScope: "week",
      planChangeNeeded: true,
    });
  });

  it("leaves plain prose untouched and fails open to no decision", () => {
    expect(readCoachReplyText("  Nice session.  ")).toEqual({
      text: "Nice session.",
      planChangeScope: undefined,
      planChangeNeeded: undefined,
    });
  });

  it("keeps a JSON-looking snippet that is not a reply envelope", () => {
    const text = 'Your zones look like {"zone":2} today.';
    expect(readCoachReplyText(text).text).toBe(text);
  });

  it("does not show an envelope that carries no reply text", () => {
    expect(readCoachReplyText('{"planChangeScope":"season"}')).toEqual({
      text: "",
      planChangeScope: "season",
      planChangeNeeded: undefined,
    });
  });
});

describe("generateCoachReply", () => {
  it("keeps the envelope out of a stored reply and uses its scope", async () => {
    const provider = new FakeProvider(
      'Good work, keep Thursday easy. {"planChangeScope":"day"}',
    );

    const outcome = await reply(provider, {
      kind: "activity_comment",
      activityDate: PLAN_TODAY,
      comment: "Felt strong.",
    });

    expect(outcome).toEqual({
      text: "Good work, keep Thursday easy.",
      planChangeNeeded: true,
      planChangeScope: "day",
    });
  });

  it("strips an envelope from a one-off question answer", async () => {
    const provider = new FakeProvider(
      'Sure, row instead. {"planChangeScope":"day"}',
    );

    const outcome = await reply(
      provider,
      { kind: "quick_question", question: "Can we do rowing today?" },
      "coaching_question",
    );

    expect(outcome).toEqual({
      text: "Sure, row instead.",
      planChangeNeeded: false,
      planChangeScope: "none",
    });
  });

  it("still fails open when the response has no structured answer", async () => {
    const provider = new FakeProvider("Nice session.");

    const outcome = await reply(provider, {
      kind: "weekly_note",
      weekStartDate: "2026-10-19",
      note: "Good week.",
    });

    expect(outcome).toEqual({
      text: "Nice session.",
      planChangeNeeded: true,
      planChangeScope: "season",
    });
  });
});
