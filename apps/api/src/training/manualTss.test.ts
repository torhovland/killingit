import { describe, expect, it } from "bun:test";
import type { LlmCompletionRequest, LlmProvider } from "../llm/openrouter.js";
import { estimateManualActivityTss } from "./manualTss.js";

class FakeProvider implements LlmProvider {
  readonly id = "fake";
  readonly requests: LlmCompletionRequest[] = [];

  constructor(private readonly response: string | Error) {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    return this.response instanceof Error
      ? Promise.reject(this.response)
      : Promise.resolve(this.response);
  }
}

describe("estimateManualActivityTss", () => {
  it("lets the coach score the entry from the athlete's wording", async () => {
    const provider = new FakeProvider(JSON.stringify({ tss: 255 }));

    const tss = await estimateManualActivityTss(
      provider,
      { apiKey: "test-key", model: "test-model" },
      {
        startDate: "2026-10-21",
        details: "I did a 3 hour Zwift race with average HR at 187 bpm",
        ftpWatts: 250,
      },
    );

    expect(tss).toBe(255);
    expect(provider.requests[0]?.messages[1]?.content).toContain(
      "Activity details: I did a 3 hour Zwift race",
    );
    expect(provider.requests[0]?.messages[1]?.content).toContain(
      "Athlete FTP: 250 W",
    );
  });

  it("tells the coach when no FTP is known", async () => {
    const provider = new FakeProvider(JSON.stringify({ tss: 40 }));

    await estimateManualActivityTss(
      provider,
      { apiKey: "test-key", model: "test-model" },
      {
        startDate: "2026-10-21",
        details: "45 minutes easy run",
        ftpWatts: null,
      },
    );

    expect(provider.requests[0]?.messages[1]?.content).toContain(
      "Athlete FTP: not stated",
    );
  });

  it("leaves the entry unscored when the coach cannot read it", async () => {
    const provider = new FakeProvider(new Error("model unavailable"));

    const tss = await estimateManualActivityTss(
      provider,
      { apiKey: "test-key", model: "test-model" },
      { startDate: "2026-10-21", details: "3-hour ride", ftpWatts: 250 },
    );

    expect(tss).toBeNull();
  });

  it("leaves the entry unscored for a response outside the contract", async () => {
    const provider = new FakeProvider("about 120");

    const tss = await estimateManualActivityTss(
      provider,
      { apiKey: "test-key", model: "test-model" },
      { startDate: "2026-10-21", details: "3-hour ride", ftpWatts: 250 },
    );

    expect(tss).toBeNull();
  });
});
