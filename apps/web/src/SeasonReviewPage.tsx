import {
  coachQuestionsResponseSchema,
  coachingInputSaveResponseSchema,
  periodReviewsResponseSchema,
  type ReviewKind,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { CoachQuestionCard } from "./CoachQuestionCard";
import { requestParsed } from "./fetchAuthed";
import { useBusyReporter } from "./AppStatus";
import { PeriodReviewCard } from "./PeriodReviewCard";
import { useApiResources } from "./useApiResource";
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
  const reportCommentSave = useBusyReporter("comment-save");
  const timeZone = useTimeZone();
  const resource = useApiResources(
    auth.isAuthenticated
      ? {
          reviews: {
            path: `${API_URL}/api/coaching/reviews`,
            schema: periodReviewsResponseSchema,
            action: "Loading the season review",
          },
          questions: {
            path: `${API_URL}/api/coaching/coach-questions`,
            schema: coachQuestionsResponseSchema,
            action: "Loading the coach's questions",
          },
        }
      : null,
    { statusSource: "season-review" },
  );
  const reviews = resource.data?.reviews.reviews ?? [];
  const coachQuestions = resource.data?.questions.answered ?? [];
  const loading = resource.loading;
  const error = resource.error;

  async function submitComment(
    kind: ReviewKind,
    startDate: string,
    comment: string,
    mode: "create" | "edit",
  ): Promise<string | null> {
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
      resource.setData((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              reviews: {
                ...previous.reviews,
                reviews: previous.reviews.reviews.map((review) =>
                  review.kind === kind && review.startDate === startDate
                    ? {
                        ...review,
                        comment,
                        coachReply: response.reply ?? review.coachReply,
                      }
                    : review,
                ),
              },
            },
      );
      return response.reply?.text ?? null;
    } finally {
      reportCommentSave(false);
    }
  }

  if (!auth.isAuthenticated) {
    return null;
  }

  const blockReviews = reviews.filter((review) => review.kind === "block");
  const weekReviews = reviews.filter((review) => review.kind === "week");

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      {error && <p className="text-destructive">Error: {error}</p>}

      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">Season review</h2>
        <p className="text-base text-muted-foreground">
          The coach's summaries of every completed week and block. Edit a
          comment to get a new coach reply and refresh the plan.
        </p>
      </div>

      {loading && reviews.length === 0 && (
        <p className="text-base text-muted-foreground">Loading reviews…</p>
      )}

      {!loading && reviews.length === 0 && (
        <p className="text-base text-muted-foreground">
          No completed week or block reviews yet.
        </p>
      )}

      {coachQuestions.length > 0 && (
        <div
          className="flex flex-col gap-3"
          data-testid="season-coach-questions"
        >
          <h3 className="text-xl font-medium">Questions from the coach</h3>
          {coachQuestions.map((question) => (
            <CoachQuestionCard key={question.id} question={question} />
          ))}
        </div>
      )}

      {blockReviews.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xl font-medium">Block reviews</h3>
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
          <h3 className="text-xl font-medium">Week reviews</h3>
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
