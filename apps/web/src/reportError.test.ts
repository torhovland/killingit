import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";
import * as Sentry from "@sentry/react";
import { SessionExpiredError } from "./auth";
import { ApiError } from "./fetchJson";
import { reportError, reportErrorQuietly } from "./reportError";

type CaptureException = typeof Sentry.captureException;

describe("web error reporting", () => {
  let captureException: Mock<CaptureException>;

  beforeEach(() => {
    captureException = spyOn(Sentry, "captureException");
  });

  afterEach(() => {
    captureException.mockRestore();
  });

  describe("reportError", () => {
    it("reports unexpected errors and returns the message", () => {
      const error = new Error("boom");

      expect(reportError(error)).toBe("boom");
      expect(captureException).toHaveBeenCalledWith(error);
    });

    it("reports server errors", () => {
      const error = new ApiError("failed: 503", 503);

      reportError(error);
      expect(captureException).toHaveBeenCalledWith(error);
    });

    it("does not report expected client errors", () => {
      reportError(new ApiError("invalid Garmin credentials", 422));
      reportError(new ApiError("Garmin requires MFA", 403));

      expect(captureException).not.toHaveBeenCalled();
    });

    it("does not report an expired session, which the athlete fixes by signing in", () => {
      const error = new SessionExpiredError();

      expect(reportError(error)).toBe(
        "Your session has expired. Sign in again to continue.",
      );
      expect(captureException).not.toHaveBeenCalled();
    });
  });

  describe("reportErrorQuietly", () => {
    it("reports unexpected errors without returning a message", () => {
      const error = new Error("boom");

      expect(reportErrorQuietly(error)).toBeUndefined();
      expect(captureException).toHaveBeenCalledWith(error);
    });

    it("reports server errors", () => {
      const error = new ApiError("failed: 503", 503);

      reportErrorQuietly(error);
      expect(captureException).toHaveBeenCalledWith(error);
    });

    it("does not report expected client errors", () => {
      reportErrorQuietly(new ApiError("invalid Garmin credentials", 422));
      reportErrorQuietly(new ApiError("Garmin requires MFA", 403));

      expect(captureException).not.toHaveBeenCalled();
    });

    it("does not report an expired session", () => {
      reportErrorQuietly(new SessionExpiredError());

      expect(captureException).not.toHaveBeenCalled();
    });
  });
});
