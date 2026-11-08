import { useCallback, useEffect, useState } from "react";
import {
  coachingInputSaveResponseSchema,
  periodReviewsResponseSchema,
  type PeriodReview,
  type ReviewKind,
} from "@killingit/shared";
import { useBusyReporter } from "./AppStatus";
import type { AuthState } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { reviewKey, selectPendingReviews } from "./pendingReviews";
import { reportError } from "./reportError";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface CoachReviewsState {
  reviews: PeriodReview[];
  /** Reviews that still need the athlete's attention this visit. */
  pending: PeriodReview[];
  error: string | null;
  load: () => Promise<void>;
  submitComment: (
    kind: ReviewKind,
    startDate: string,
    comment: string,
    mode: "create" | "edit",
  ) => Promise<string | null>;
  markNoComment: (kind: ReviewKind, startDate: string) => Promise<void>;
}

/**
 * Loads completed week and block reviews and saves the athlete's response. A
 * review answered during this visit stays on the page until it reloads.
 */
export function useCoachReviews(
  auth: AuthState,
  timeZone: string,
  onChanged?: () => void,
): CoachReviewsState {
  const reportCommentSave = useBusyReporter("review-comment-save");
  const [reviews, setReviews] = useState<PeriodReview[]>([]);
  const [keptReviewKeys, setKeptReviewKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await requestParsed(
        `${API_URL}/api/coaching/reviews`,
        auth,
        periodReviewsResponseSchema,
        "Loading your week and block reviews",
      );
      setReviews(response.reviews);
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }, [auth]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void load();
    // Only re-run when sign-in state flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  const keepForVisit = useCallback((kind: ReviewKind, startDate: string) => {
    setKeptReviewKeys((current) =>
      new Set(current).add(reviewKey({ kind, startDate })),
    );
  }, []);

  const submitComment = useCallback(
    async (
      kind: ReviewKind,
      startDate: string,
      comment: string,
      mode: "create" | "edit",
    ): Promise<string | null> => {
      reportCommentSave(true);
      try {
        const { today } = getToday(timeZone);
        const response = await requestParsed(
          `${API_URL}/api/coaching/reviews/${kind}/${startDate}/comments`,
          auth,
          coachingInputSaveResponseSchema,
          "Saving your comment",
          {
            method: mode === "edit" ? "PUT" : "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              today,
              timezone: timeZone,
              comment,
            }),
          },
        );
        // Leave the review in place for this visit; the next page load only
        // shows reviews without a response.
        keepForVisit(kind, startDate);
        onChanged?.();
        return response.reply?.text ?? null;
      } finally {
        reportCommentSave(false);
      }
    },
    [auth, timeZone, keepForVisit, onChanged, reportCommentSave],
  );

  const markNoComment = useCallback(
    async (kind: ReviewKind, startDate: string): Promise<void> => {
      await requestParsed(
        `${API_URL}/api/coaching/reviews/${kind}/${startDate}/reviewed`,
        auth,
        coachingInputSaveResponseSchema,
        "Marking the review as reviewed",
        { method: "POST" },
      );
      keepForVisit(kind, startDate);
      setReviews((current) =>
        current.map((review) =>
          review.kind === kind && review.startDate === startDate
            ? { ...review, reviewed: true }
            : review,
        ),
      );
    },
    [auth, keepForVisit],
  );

  const pending = selectPendingReviews(reviews, keptReviewKeys);

  return { reviews, pending, error, load, submitComment, markNoComment };
}
