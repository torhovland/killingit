import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";
import * as Sentry from "@sentry/react";
import { reportError } from "./reportError";

type CaptureException = (exception: unknown) => string;

describe("reportError", () => {
  let capture: Mock<CaptureException>;

  afterEach(() => {
    capture.mockRestore();
  });

  it("reports an Error to Sentry and returns its message", () => {
    capture = spyOn(Sentry, "captureException");

    const message = reportError(new Error("boom"));

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(message).toBe("boom");
  });

  it("reports a non-Error value to Sentry and stringifies it", () => {
    capture = spyOn(Sentry, "captureException");

    const message = reportError("something went wrong");

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[0]).toBe("something went wrong");
    expect(message).toBe("something went wrong");
  });
});
