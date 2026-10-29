import { useEffect, useState } from "react";
import {
  coachQuestionsResponseSchema,
  coachingInputSaveResponseSchema,
  periodReviewsResponseSchema,
  type CoachQuestion,
  type PeriodReview,
  type ReviewKind,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { CoachQuestionCard } from "./CoachQuestionCard";
import { fetchJsonAuthed } from "./fetchAuthed";
import { useAppStatus, useBusyReporter } from "./AppStatus";
import { PeriodReviewCard } from "./PeriodReviewCard";
import { reportError } from "./reportError";
import { useTimeZone } from "./TimeZoneContext";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * The season review page: every completed week and block summary, with its
 * athlete comment and the coach's reply. Editing a comment generates a new
 * reply and starts a plan refresh.
 */
export function SeasonReviewPage() {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const reportCommentSave = useBusyReporter("comment-save");
  const timeZone = useTimeZone();
  const [reviews, setReviews] = useState<PeriodReview[]>([]);
  const [coachQuestions, setCoachQuestions] = useState<CoachQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus("season-review", loading ? "loading" : null);
    return () => setStatus("season-review", null);
  }, [loading, setStatus]);

  async function loadReviews(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [response, questionsResponse] = await Promise.all([
        fetchJsonAuthed<unknown>(`${API_URL}/api/coaching/reviews`, auth),
        fetchJsonAuthed<unknown>(
          `${API_URL}/api/coaching/coach-questions`,
          auth,
        ),
      ]);
      const parsed = periodReviewsResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Loading the season review returned an unexpected response",
          { cause: parsed.error },
        );
      }
      const questions =
        coachQuestionsResponseSchema.safeParse(questionsResponse);
      if (!questions.success) {
        throw new Error(
          "Loading the coach's questions returned an unexpected response",
          { cause: questions.error },
        );
      }
      setReviews(parsed.data.reviews);
      setCoachQuestions(questions.data.answered);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoading(false);
    }
  }

  async function submitComment(
    kind: ReviewKind,
    startDate: string,
    comment: string,
    mode: "create" | "edit",
  ): Promise<string | null> {
    reportCommentSave(true);
    try {
      const { today } = getToday(timeZone);
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/reviews/${kind}/${startDate}/comments`,
        auth,
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
      const parsed = coachingInputSaveResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error("Saving your comment returned an unexpected response", {
          cause: parsed.error,
        });
      }
      setReviews((current) =>
        current.map((review) =>
          review.kind === kind && review.startDate === startDate
            ? {
                ...review,
                comment,
                coachReply: parsed.data.reply ?? review.coachReply,
              }
            : review,
        ),
      );
      return parsed.data.reply?.text ?? null;
    } finally {
      reportCommentSave(false);
    }
  }

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void loadReviews();
    // Only re-run when sign-in state flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  if (!auth.isAuthenticated) {
    return null;
  }

  const blockReviews = reviews.filter((review) => review.kind === "block");
  const weekReviews = reviews.filter((review) => review.kind === "week");

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      {error && <p className="text-destructive">Error: {error}</p>}

      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Season review</h2>
        <p className="text-sm text-muted-foreground">
          The coach's summaries of every completed week and block. Edit a
          comment to get a new coach reply and refresh the plan.
        </p>
      </div>

      {loading && reviews.length === 0 && (
        <p className="text-sm text-muted-foreground">Loading reviews…</p>
      )}

      {!loading && reviews.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No completed week or block reviews yet.
        </p>
      )}

      {coachQuestions.length > 0 && (
        <div
          className="flex flex-col gap-3"
          data-testid="season-coach-questions"
        >
          <h3 className="text-lg font-medium">Coach questions</h3>
          {coachQuestions.map((question) => (
            <CoachQuestionCard key={question.id} question={question} />
          ))}
        </div>
      )}

      {blockReviews.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-medium">Block reviews</h3>
          {blockReviews.map((review) => (
            <PeriodReviewCard
              key={`block:${review.startDate}`}
              review={review}
              onSubmitComment={submitComment}
            />
          ))}
        </div>
      )}

      {weekReviews.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-medium">Week reviews</h3>
          {weekReviews.map((review) => (
            <PeriodReviewCard
              key={`week:${review.startDate}`}
              review={review}
              onSubmitComment={submitComment}
              showWeeklyNote
            />
          ))}
        </div>
      )}
    </section>
  );
}
