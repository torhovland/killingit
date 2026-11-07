import { useEffect, useRef, useState } from "react";
import {
  coachQuestionsResponseSchema,
  coachingInputSaveResponseSchema,
  periodReviewsResponseSchema,
  quickQuestionResponseSchema,
  weeklyNoteResponseSchema,
  type CoachAnalysis,
  type CoachQuestion,
  type PeriodReview,
  type ReviewKind,
} from "@killingit/shared";
import { ActivityCard } from "./ActivityCard";
import { useAppStatus, useBusyReporter } from "./AppStatus";
import { useAuth } from "./auth";
import { CoachPlanSection } from "./CoachPlanSection";
import { CoachQuestionCard } from "./CoachQuestionCard";
import { parseCoachingSaveResponse } from "./coachingSave";
import { fetchJsonAuthed } from "./fetchAuthed";
import { FoodLogSection } from "./FoodLogSection";
import { FormattedText } from "./FormattedText";
import { selectPendingActivities } from "./pendingActivities";
import { PeriodReviewCard } from "./PeriodReviewCard";
import { reviewKey, selectPendingReviews } from "./pendingReviews";
import { reportError } from "./reportError";
import { SubmitButton } from "./SubmitButton";
import { useTimeZone } from "./TimeZoneContext";
import { useActivityFeed } from "./useActivityFeed";
import { useStatuses } from "./useStatuses";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface CoachDashboardProps {
  /** Increment when athlete answers change so the plan refreshes. */
  planRefreshKey: number;
  /** Whether the athlete wants the food log and diet advice. */
  dietAdvice: boolean;
}

/**
 * The main coaching page: activities that still need the athlete's attention,
 * the tabbed plan, and the coaching inputs that shape it.
 */
export function CoachDashboard({
  planRefreshKey,
  dietAdvice,
}: CoachDashboardProps) {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const reportReviewCommentSave = useBusyReporter("review-comment-save");
  const reportWeeklyNoteSave = useBusyReporter("weekly-note-save");
  const reportQuestion = useBusyReporter("by-the-way");
  const timeZone = useTimeZone();
  const statuses = useStatuses(auth);
  // Commented-on activities stay on the page for this visit. The server feed
  // omits them once they have been answered; a reload clears the kept set.
  const feed = useActivityFeed(auth, timeZone, { keepAnswered: true });
  const [weeklyNote, setWeeklyNote] = useState<string>("");
  const [weeklyNoteReply, setWeeklyNoteReply] = useState<CoachAnalysis | null>(
    null,
  );
  const [question, setQuestion] = useState("");
  const [questionReply, setQuestionReply] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [savingWeeklyNote, setSavingWeeklyNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPlanRefresh, setLocalPlanRefresh] = useState(0);
  const [reviews, setReviews] = useState<PeriodReview[]>([]);
  const [coachQuestion, setCoachQuestion] = useState<CoachQuestion | null>(
    null,
  );
  // Commented-on reviews stay on the page for this visit.
  const keptReviewKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    setStatus("dashboard-status", statuses.loading ? "loading" : null);
    return () => setStatus("dashboard-status", null);
  }, [statuses.loading, setStatus]);

  useEffect(() => {
    setStatus("dashboard-activities", feed.syncing ? "syncing" : null);
    return () => setStatus("dashboard-activities", null);
  }, [feed.syncing, setStatus]);

  async function loadReviews(): Promise<void> {
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/reviews`,
        auth,
      );
      const parsed = periodReviewsResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Loading your week and block reviews returned an unexpected response",
          { cause: parsed.error },
        );
      }
      setReviews(parsed.data.reviews);
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }

  async function loadCoachQuestions(): Promise<void> {
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/coach-questions`,
        auth,
      );
      const parsed = coachQuestionsResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Loading the coach's questions returned an unexpected response",
          { cause: parsed.error },
        );
      }
      setCoachQuestion(parsed.data.pending);
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }

  async function submitCoachAnswer(
    id: number,
    answer: string,
  ): Promise<string | null> {
    const { today } = getToday(timeZone);
    const res = await fetchJsonAuthed<unknown>(
      `${API_URL}/api/coaching/coach-questions/${id}/answer`,
      auth,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ today, timezone: timeZone, answer }),
      },
    );
    const parsed = coachingInputSaveResponseSchema.safeParse(res);
    if (!parsed.success) {
      throw new Error("Saving your answer returned an unexpected response", {
        cause: parsed.error,
      });
    }
    setCoachQuestion((current) =>
      current === null || current.id !== id
        ? current
        : {
            ...current,
            answer,
            coachReply: parsed.data.reply,
            answeredAt: new Date().toISOString(),
          },
    );
    setLocalPlanRefresh((value) => value + 1);
    return parsed.data.reply?.text ?? null;
  }

  async function fetchWeeklyNote(): Promise<void> {
    try {
      const { today } = getToday(timeZone);
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/weekly/notes?today=${today}`,
        auth,
      );
      const parsed = weeklyNoteResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Loading the weekly note returned an unexpected response",
          { cause: parsed.error },
        );
      }
      setWeeklyNote(parsed.data.note ?? "");
      setWeeklyNoteReply(parsed.data.reply);
    } catch (err: unknown) {
      // Don't block the dashboard if the note fails to load.
      console.error("Failed to load weekly note:", err);
    }
  }

  async function submitReviewComment(
    kind: ReviewKind,
    startDate: string,
    comment: string,
    mode: "create" | "edit",
  ): Promise<string | null> {
    reportReviewCommentSave(true);
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
      // Leave the review in place for this visit; the next page load only shows
      // reviews without a response.
      keptReviewKeys.current.add(reviewKey({ kind, startDate }));
      setLocalPlanRefresh((key) => key + 1);
      return parsed.data.reply?.text ?? null;
    } finally {
      reportReviewCommentSave(false);
    }
  }

  async function markReviewNoComment(
    kind: ReviewKind,
    startDate: string,
  ): Promise<void> {
    const response = await fetchJsonAuthed<unknown>(
      `${API_URL}/api/coaching/reviews/${kind}/${startDate}/reviewed`,
      auth,
      { method: "POST" },
    );
    parseCoachingSaveResponse(response);
    keptReviewKeys.current.add(reviewKey({ kind, startDate }));
    setReviews((current) =>
      current.map((review) =>
        review.kind === kind && review.startDate === startDate
          ? { ...review, reviewed: true }
          : review,
      ),
    );
  }

  async function submitWeeklyNote(note: string): Promise<void> {
    setSavingWeeklyNote(true);
    reportWeeklyNoteSave(true);
    try {
      const { today } = getToday(timeZone);
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/weekly/notes`,
        auth,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            today,
            timezone: timeZone,
            note,
          }),
        },
      );
      const parsed = coachingInputSaveResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error("Saving your note returned an unexpected response", {
          cause: parsed.error,
        });
      }
      setWeeklyNoteReply(parsed.data.reply);
      setLocalPlanRefresh((key) => key + 1);
    } finally {
      setSavingWeeklyNote(false);
      reportWeeklyNoteSave(false);
    }
  }

  async function askQuestion(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!question.trim() || asking) {
      return;
    }
    setAsking(true);
    setError(null);
    reportQuestion(true);
    try {
      const { today } = getToday(timeZone);
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/questions`,
        auth,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ today, question: question.trim() }),
        },
      );
      const parsed = quickQuestionResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error("Asking the coach returned an unexpected response", {
          cause: parsed.error,
        });
      }
      setQuestionReply(
        parsed.data.reply?.text ??
          "The coach could not answer right now. Try again later.",
      );
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setAsking(false);
      reportQuestion(false);
    }
  }

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void fetchWeeklyNote();
    void loadReviews();
    void loadCoachQuestions();
    // Only re-run when sign-in state flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  useEffect(() => {
    if (!statuses.garmin?.connected) {
      return;
    }
    if (feed.data === null || feed.data.activities.length === 0) {
      void feed.loadCached();
    }
    void feed.loadAnalyses();
    // Re-run when Garmin connects or the LLM setup changes, not every render.
  }, [statuses.garmin?.connected, statuses.llm?.configured]);

  // The coach stores replies before it starts the slower plan refresh, so poll
  // the cached feed while any comment is still waiting for its reply.
  useEffect(() => {
    if (!auth.isAuthenticated || !feed.awaitingReplies) {
      return;
    }
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (attempts > 40) {
        clearInterval(timer);
        return;
      }
      void feed.loadCached();
    }, 1500);
    return () => clearInterval(timer);
  }, [auth.isAuthenticated, feed.awaitingReplies, feed.loadCached]);

  if (!auth.isAuthenticated) {
    return null;
  }

  const errorMessage = error ?? feed.error ?? statuses.error;

  if (statuses.loading && (statuses.garmin === null || statuses.llm === null)) {
    return (
      <p
        className="text-base text-muted-foreground"
        data-testid="coach-loading"
      >
        Loading integrations…
      </p>
    );
  }

  if (statuses.garmin === null || statuses.llm === null) {
    return (
      <section className="flex flex-col items-center gap-2">
        {errorMessage && (
          <p className="text-destructive">Error: {errorMessage}</p>
        )}
        <button
          type="button"
          className="rounded border bg-card px-4 py-2 enabled:hover:bg-muted"
          onClick={() => void statuses.reload()}
        >
          Retry
        </button>
      </section>
    );
  }

  const pendingActivities = feed.data
    ? selectPendingActivities(feed.data.activities, feed.keptActivityIds)
    : [];
  const pendingReviews = selectPendingReviews(reviews, keptReviewKeys.current);
  const pendingWeeks = pendingReviews.filter(
    (review) => review.kind === "week",
  );
  const pendingBlocks = pendingReviews.filter(
    (review) => review.kind === "block",
  );
  const ready = statuses.garmin.connected && statuses.llm.configured;

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      {errorMessage && (
        <p className="text-destructive" data-testid="coach-error">
          Error: {errorMessage}
        </p>
      )}

      <FoodLogSection
        enabled={dietAdvice}
        onLogged={() => setLocalPlanRefresh((value) => value + 1)}
      />

      {coachQuestion !== null && (
        <section className="flex flex-col gap-3" data-testid="coach-question">
          <CoachQuestionCard
            question={coachQuestion}
            onSubmitAnswer={submitCoachAnswer}
          />
        </section>
      )}

      {statuses.garmin.connected && pendingActivities.length > 0 && (
        <section
          className="flex flex-col gap-3"
          data-testid="pending-activities"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-2xl font-semibold">Recent activities</h2>
            <p className="text-base text-muted-foreground">
              Add a comment, or mark it with no comment.
            </p>
          </div>
          {pendingActivities.map((activity) => (
            <ActivityCard
              key={activity.id}
              activity={activity}
              onSubmitComment={feed.submitComment}
              onNoComment={feed.markNoComment}
              onDelete={feed.deleteActivity}
            />
          ))}
        </section>
      )}

      {pendingReviews.length > 0 && (
        <section className="flex flex-col gap-3" data-testid="pending-reviews">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold">Completed training</h2>
            <p className="text-base text-muted-foreground">
              Review your coach's summary and add a comment.
            </p>
          </div>
          {pendingBlocks.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-xl font-medium">Block reviews</h3>
              {pendingBlocks.map((review) => (
                <PeriodReviewCard
                  key={`block:${review.startDate}`}
                  review={review}
                  onSubmitComment={submitReviewComment}
                  onNoComment={markReviewNoComment}
                />
              ))}
            </div>
          )}
          {pendingWeeks.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-xl font-medium">Week reviews</h3>
              {pendingWeeks.map((review) => (
                <PeriodReviewCard
                  key={`week:${review.startDate}`}
                  review={review}
                  onSubmitComment={submitReviewComment}
                  onNoComment={markReviewNoComment}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <CoachPlanSection
        refreshKey={planRefreshKey + localPlanRefresh + feed.revision}
        ready={ready}
        dietAdvice={dietAdvice}
        onGenerated={() => {
          void feed.loadAnalyses();
          void loadReviews();
          void loadCoachQuestions();
        }}
      />

      <section
        className="flex flex-col gap-4 rounded-lg border bg-card p-4 text-left"
        data-testid="coaching-inputs"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">Talk to the coach</h2>
          <p className="text-base text-muted-foreground">
            Share context with your coach. The weekly note shapes your plan; a
            by-the-way question is only a conversation.
          </p>
        </div>

        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!weeklyNote.trim()) {
              return;
            }
            void submitWeeklyNote(weeklyNote).catch((err: unknown) =>
              setError(reportError(err)),
            );
          }}
        >
          <label className="text-base font-medium" htmlFor="weekly-note">
            Weekly note
          </label>
          <p className="text-sm text-muted-foreground">
            Requests and additional information that should influence your
            training plan. Saving it refreshes the affected plan.
          </p>
          <textarea
            id="weekly-note"
            name="note"
            className="w-full rounded border bg-card p-2 text-base"
            placeholder="e.g. I won't have time to train on Thursday this week."
            rows={2}
            value={weeklyNote}
            onChange={(event) => setWeeklyNote(event.target.value)}
          />
          <SubmitButton
            busy={savingWeeklyNote}
            className="self-start rounded border border-transparent bg-primary px-3 py-1 text-base text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
            disabled={!weeklyNote.trim()}
          >
            {savingWeeklyNote ? "Coach is thinking…" : "Send to coach"}
          </SubmitButton>
          {weeklyNoteReply && (
            <div
              className="flex flex-col gap-1 rounded border bg-inset p-2 text-base"
              data-testid="weekly-note-reply"
            >
              <span className="font-medium">Coach:</span>
              <FormattedText text={weeklyNoteReply.text} />
            </div>
          )}
        </form>

        <form
          className="flex flex-col gap-2 border-t pt-3"
          onSubmit={(event) => void askQuestion(event)}
        >
          <label className="text-base font-medium" htmlFor="by-the-way">
            By the way
          </label>
          <p className="text-sm text-muted-foreground">
            Ask your coach a one-off question. The question and answer are not
            stored and do not influence your training plan.
          </p>
          <textarea
            id="by-the-way"
            name="question"
            className="w-full rounded border bg-card p-2 text-base"
            placeholder="e.g. Should I do my long run on Saturday or Sunday?"
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <SubmitButton
            busy={asking}
            className="self-start rounded border border-transparent bg-primary px-3 py-1 text-base text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
            disabled={!question.trim()}
          >
            {asking ? "Coach is thinking…" : "Ask the coach"}
          </SubmitButton>
          {questionReply && (
            <div
              className="flex flex-col gap-1 rounded border bg-inset p-2 text-base"
              data-testid="by-the-way-reply"
            >
              <span className="font-medium">Coach:</span>
              <FormattedText text={questionReply} />
            </div>
          )}
        </form>
      </section>

      {!statuses.garmin.connected && (
        <p className="text-base text-muted-foreground">
          Connect Garmin in Settings to see your recent activities.
        </p>
      )}
    </section>
  );
}
