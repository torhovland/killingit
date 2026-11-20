import { describe, expect, it } from "bun:test";
import { TimeoutError } from "@auth0/auth0-react";
import { requestTokenWithRetry } from "./tokenRetry";

/** A request whose answers are consumed in order. */
function sequence(...answers: Array<string | Error>): {
  request: () => Promise<string>;
  calls: () => number;
} {
  let calls = 0;
  return {
    request: (): Promise<string> => {
      const answer = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer ?? "");
    },
    calls: () => calls,
  };
}

describe("requestTokenWithRetry", () => {
  it("returns the token without retrying", async () => {
    const { request, calls } = sequence("access-token");

    expect(await requestTokenWithRetry(request)).toBe("access-token");
    expect(calls()).toBe(1);
  });

  it("retries once after the SDK's renewal lock timed out", async () => {
    const { request, calls } = sequence(new TimeoutError(), "access-token");

    expect(await requestTokenWithRetry(request)).toBe("access-token");
    expect(calls()).toBe(2);
  });

  it("propagates any other failure without retrying", async () => {
    const failure = new Error("network down");
    const { request, calls } = sequence(failure);

    expect(
      await requestTokenWithRetry(request).catch((error: unknown) => error),
    ).toBe(failure);
    expect(calls()).toBe(1);
  });

  it("reports a friendly error when both attempts time out", async () => {
    const { request, calls } = sequence(new TimeoutError());

    const error = await requestTokenWithRetry(request).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("TokenRenewalTimeoutError");
    expect((error as Error).message).toBe(
      "Renewing your session timed out. Check your connection and try again.",
    );
    expect((error as Error).cause).toBeInstanceOf(TimeoutError);
    expect(calls()).toBe(2);
  });

  it("propagates a different failure from the retry", async () => {
    const failure = new Error("refresh token revoked");
    const { request, calls } = sequence(new TimeoutError(), failure);

    expect(
      await requestTokenWithRetry(request).catch((error: unknown) => error),
    ).toBe(failure);
    expect(calls()).toBe(2);
  });
});
