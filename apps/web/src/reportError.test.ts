import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";
import * as Sentry from "@sentry/react";
import { ApiError } from "./fetchJson";
import { reportError } from "./reportError";

type CaptureException = typeof Sentry.captureException;

describe("reportError", () => {
  let captureException: Mock<CaptureException>;

  function spyOnCapture() {
    captureException = spyOn(Sentry, "captureException");
  }

  afterEach(() => {
    captureException.mockRestore();
  });

  it("reports unexpected errors and returns the message", () => {
    spyOnCapture();
    const error = new Error("boom");

    expect(reportError(error)).toBe("boom");
    expect(captureException).toHaveBeenCalledWith(error);
  });

  it("reports server errors", () => {
    spyOnCapture();
    const error = new ApiError("failed: 503", 503);

    reportError(error);
    expect(captureException).toHaveBeenCalledWith(error);
  });

  it("does not report expected client errors", () => {
    spyOnCapture();

    reportError(new ApiError("invalid Garmin credentials", 401));
    reportError(new ApiError("Garmin requires MFA", 403));

    expect(captureException).not.toHaveBeenCalled();
  });
});
