import { describe, expect, it } from "bun:test";
import { createAbortableRequests, isAbortError } from "./requestAbort";

function abortable(signal: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

async function settle<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe("isAbortError", () => {
  it("recognises the platform's AbortError", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(
      isAbortError(Object.assign(new Error("Aborted"), { name: "AbortError" })),
    ).toBe(true);
  });

  it("does not treat an ordinary failure as an abort", () => {
    expect(isAbortError(new Error("Network down"))).toBe(false);
    expect(isAbortError("Aborted")).toBe(false);
  });
});

describe("createAbortableRequests", () => {
  it("aborts every request that is still in flight", async () => {
    const runner = createAbortableRequests();
    const signals: AbortSignal[] = [];
    const first = runner.run((signal) => {
      signals.push(signal);
      return abortable(signal);
    });
    const second = runner.run((signal) => {
      signals.push(signal);
      return abortable(signal);
    });

    runner.abortAll();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(true);
    expect(isAbortError(await settle(first))).toBe(true);
    expect(isAbortError(await settle(second))).toBe(true);
  });

  it("does not touch a request started after an abort", async () => {
    const runner = createAbortableRequests();
    await runner.run(() => Promise.resolve("done"));
    runner.abortAll();

    const signals: AbortSignal[] = [];
    const request = runner.run((signal) => {
      signals.push(signal);
      return abortable(signal);
    });

    expect(signals[0]?.aborted).toBe(false);
    runner.abortAll();
    expect(isAbortError(await settle(request))).toBe(true);
  });
});
