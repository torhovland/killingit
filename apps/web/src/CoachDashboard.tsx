import { useEffect, useRef, useState } from "react";
import {
  analyzedActivitiesResponseSchema,
  coachQuestionsResponseSchema,
  coachingInputSaveResponseSchema,
  garminConnectionStatusSchema,
  llmSettingsSchema,
  periodReviewsResponseSchema,
  quickQuestionResponseSchema,
  weeklyNoteResponseSchema,
  type AnalyzedActivitiesResponse,
  type CoachAnalysis,
  type CoachQuestion,
  type GarminConnectionStatus,
  type LlmSettings,
  type PeriodReview,
  type ReviewKind,
} from "@killingit/shared";
import { ActivityCard } from "./ActivityCard";
import { loadCachedActivities, saveCachedActivities } from "./activityCache";
import { useAppStatus, useBusyReporter } from "./AppStatus";
import { useAuth } from "./auth";
import { CoachPlanSection } from "./CoachPlanSection";
import { CoachQuestionCard } from "./CoachQuestionCard";
import { fetchJsonAuthed } from "./fetchAuthed";
import { selectPendingActivities } from "./pendingActivities";
import { PeriodReviewCard } from "./PeriodReviewCard";
import { reviewKey, selectPendingReviews } from "./pendingReviews";
import { reportError } from "./reportError";
import { SubmitButton } from "./SubmitButton";
import { useTimeZone } from "./TimeZoneContext";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface CoachDashboardProps {
  /** Increment when athlete answers change so the plan refreshes. */
  planRefreshKey: number;
}

/**
 * The main coaching page: activities that still need the athlete's attention,
 * the tabbed plan, and the coaching inputs that shape it.
 */
export function CoachDashboard({ planRefreshKey }: CoachDashboardProps) {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const reportCommentSave = useBusyReporter("comment-save");
  const reportWeeklyNoteSave = useBusyReporter("weekly-note-save");
  const reportQuestion = useBusyReporter("by-the-way");
  const timeZone = useTimeZone();
  // `loadAnalyses` is started by an effect that does not depend on the auth
  // object; keep the latest account id in a ref so a cache write after the
  // request settles uses the real `sub` rather than an early `null`.
  const authSub = useRef(auth.sub);
  authSub.current = auth.sub;
  const [garmin, setGarmin] = useState<GarminConnectionStatus | null>(null);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [data, setData] = useState<AnalyzedActivitiesResponse | null>(() =>
    loadCachedActivities(auth.sub),
  );
  const [weeklyNote, setWeeklyNote] = useState<string>("");
  const [weeklyNoteReply, setWeeklyNoteReply] = useState<CoachAnalysis | null>(
    null,
  );
  const [question, setQuestion] = useState("");
  const [questionReply, setQuestionReply] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [savingWeeklyNote, setSavingWeeklyNote] = useState(false);
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [loadingAnalyses, setLoadingAnalyses] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPlanRefresh, setLocalPlanRefresh] = useState(0);
  const [reviews, setReviews] = useState<PeriodReview[]>([]);
  const [coachQuestion, setCoachQuestion] = useState<CoachQuestion | null>(
    null,
  );
  // Commented-on activities and reviews stay on the page for this visit. The
  // server feed omits them once they have been answered; a reload clears this.
  const keptActivityIds = useRef<Set<string>>(new Set());
  const keptReviewKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    setStatus("dashboard-status", loadingStatuses ? "loading" : null);
    return () => setStatus("dashboard-status", null);
  }, [loadingStatuses, setStatus]);

  useEffect(() => {
    setStatus("dashboard-activities", loadingAnalyses ? "syncing" : null);
    return () => setStatus("dashboard-activities", null);
  }, [loadingAnalyses, setStatus]);

  async function loadStatuses(): Promise<void> {
    setLoadingStatuses(true);
    setError(null);
    try {
      const [garminRes, llmRes] = await Promise.all([
        fetchJsonAuthed<unknown>(`${API_URL}/api/garmin/status`, auth),
        fetchJsonAuthed<unknown>(`${API_URL}/api/llm/settings`, auth),
      ]);
      const garminParsed = garminConnectionStatusSchema.safeParse(garminRes);
      const llmParsed = llmSettingsSchema.safeParse(llmRes);
      if (!garminParsed.success || !llmParsed.success) {
        throw new Error("Status endpoints returned an unexpected response");
      }
      setGarmin(garminParsed.data);
      setLlm(llmParsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoadingStatuses(false);
    }
  }

  async function loadCachedFeed(): Promise<void> {
    try {
      const res = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities/cached`,
        auth,
      );
      const parsed = analyzedActivitiesResponseSchema.safeParse(res);
      if (!parsed.success || parsed.data.activities.length === 0) {
        return;
      }
      saveCachedActivities(authSub.current, parsed.data);
      setData((current) =>
        current === null || current.activities.length === 0
          ? parsed.data
          : current,
      );
    } catch (err: unknown) {
      // The live sync is still running; a missing server cache is not an error.
      console.error("Failed to load cached activities:", err);
    }
  }

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

  async function loadAnalyses(refresh = false): Promise<void> {
    setLoadingAnalyses(true);
    setError(null);
    try {
      const { today } = getToday(timeZone);
      const params = new URLSearchParams({
        limit: "20",
        today,
        timezone: timeZone,
      });
      if (refresh) {
        params.set("refresh", "true");
      }
      const res = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities?${params.toString()}`,
        auth,
      );
      const parsed = analyzedActivitiesResponseSchema.safeParse(res);
      if (!parsed.success) {
        throw new Error("Coaching endpoint returned an unexpected response", {
          cause: parsed.error,
        });
      }
      setData(parsed.data);
      saveCachedActivities(authSub.current, parsed.data);
      // A new analysis may have started a background plan revision.
      setLocalPlanRefresh((key) => key + 1);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoadingAnalyses(false);
    }
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

  function coachingDateQuery(): string {
    return new URLSearchParams({
      today: getToday(timeZone).today,
      timezone: timeZone,
    }).toString();
  }

  async function deleteActivity(activityId: string): Promise<void> {
    const response = await fetchJsonAuthed<unknown>(
      `${API_URL}/api/coaching/activities/${activityId}?${coachingDateQuery()}`,
      auth,
      { method: "DELETE" },
    );
    parseSaveResponse(response);
    const next = data
      ? {
          ...data,
          activities: data.activities.filter(
            (activity) => String(activity.id) !== activityId,
          ),
        }
      : null;
    setData(next);
    if (next) {
      saveCachedActivities(authSub.current, next);
    }
    setLocalPlanRefresh((key) => key + 1);
  }

  async function submitComment(
    activityId: string,
    comment: string,
    mode: "create" | "edit",
  ): Promise<string | null> {
    reportCommentSave(true);
    try {
      const { today } = getToday(timeZone);
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities/${activityId}/comments`,
        auth,
        {
          method: mode === "edit" ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            today,
            timezone: timeZone,
            activityDate: activityStartDate(activityId),
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
      // Leave the activity in place for this visit. A reload only shows
      // activities without a response, so the commented activity drops off then.
      keptActivityIds.current.add(activityId);
      setLocalPlanRefresh((key) => key + 1);
      return parsed.data.reply?.text ?? null;
    } finally {
      reportCommentSave(false);
    }
  }

  async function markNoComment(activityId: string): Promise<void> {
    const response = await fetchJsonAuthed<unknown>(
      `${API_URL}/api/coaching/activities/${activityId}/reviewed`,
      auth,
      { method: "POST" },
    );
    parseSaveResponse(response);
    const next = data
      ? {
          ...data,
          activities: data.activities.map((activity) =>
            String(activity.id) === activityId
              ? { ...activity, reviewed: true }
              : activity,
          ),
        }
      : null;
    setData(next);
    if (next) {
      saveCachedActivities(authSub.current, next);
    }
  }

  async function submitReviewComment(
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
      // Leave the review in place for this visit; the next page load only shows
      // reviews without a response.
      keptReviewKeys.current.add(reviewKey({ kind, startDate }));
      setLocalPlanRefresh((key) => key + 1);
      return parsed.data.reply?.text ?? null;
    } finally {
      reportCommentSave(false);
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
    parseSaveResponse(response);
    keptReviewKeys.current.add(reviewKey({ kind, startDate }));
    setReviews((current) =>
      current.map((review) =>
        review.kind === kind && review.startDate === startDate
          ? { ...review, reviewed: true }
          : review,
      ),
    );
  }

  function activityStartDate(activityId: string): string {
    const activity = data?.activities.find(
      (entry) => String(entry.id) === activityId,
    );
    return (activity?.startDate ?? getToday(timeZone).today).slice(0, 10);
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

  function parseSaveResponse(response: unknown): void {
    const parsed = coachingInputSaveResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error("Saving the activity returned an unexpected response", {
        cause: parsed.error,
      });
    }
  }

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void loadStatuses();
    void fetchWeeklyNote();
    void loadReviews();
    void loadCoachQuestions();
    // Only re-run when sign-in state flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  useEffect(() => {
    if (!garmin?.connected) {
      return;
    }
    if (data === null || data.activities.length === 0) {
      void loadCachedFeed();
    }
    void loadAnalyses();
    // Re-run when Garmin connects or the LLM setup changes, not every render.
  }, [garmin?.connected, llm?.configured]);

  // Auth0 can report an authenticated session before it exposes `user.sub`.
  useEffect(() => {
    if (data !== null) {
      return;
    }
    const cached = loadCachedActivities(auth.sub);
    if (cached !== null) {
      setData(cached);
    }
  }, [auth.sub, data]);

  if (!auth.isAuthenticated) {
    return null;
  }

  if (loadingStatuses && (garmin === null || llm === null)) {
    return (
      <p
        className="text-base text-muted-foreground"
        data-testid="coach-loading"
      >
        Loading integrations…
      </p>
    );
  }

  if (garmin === null || llm === null) {
    return (
      <section className="flex flex-col items-center gap-2">
        {error && <p className="text-destructive">Error: {error}</p>}
        <button
          type="button"
          className="rounded border bg-card px-4 py-2 enabled:hover:bg-muted"
          onClick={() => void loadStatuses()}
        >
          Retry
        </button>
      </section>
    );
  }

  const pendingActivities = data
    ? selectPendingActivities(data.activities, keptActivityIds.current)
    : [];
  const pendingReviews = selectPendingReviews(reviews, keptReviewKeys.current);
  const pendingWeeks = pendingReviews.filter(
    (review) => review.kind === "week",
  );
  const pendingBlocks = pendingReviews.filter(
    (review) => review.kind === "block",
  );
  const ready = garmin.connected && llm.configured;

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      {error && (
        <p className="text-destructive" data-testid="coach-error">
          Error: {error}
        </p>
      )}

      {coachQuestion !== null && (
        <section className="flex flex-col gap-3" data-testid="coach-question">
          <CoachQuestionCard
            question={coachQuestion}
            onSubmitAnswer={submitCoachAnswer}
          />
        </section>
      )}

      {garmin.connected && pendingActivities.length > 0 && (
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
              onSubmitComment={submitComment}
              onNoComment={markNoComment}
              onDelete={deleteActivity}
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
        refreshKey={planRefreshKey + localPlanRefresh}
        ready={ready}
        onGenerated={() => {
          void loadAnalyses();
          void loadReviews();
          void loadCoachQuestions();
        }}
      />

      <section
        className="flex flex-col gap-4 rounded-lg border bg-card p-4 text-left"
        data-testid="coaching-inputs"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">Coaching inputs</h2>
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
            <p
              className="rounded border bg-muted p-2 text-base"
              data-testid="weekly-note-reply"
            >
              <span className="font-medium">Coach:</span> {weeklyNoteReply.text}
            </p>
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
            <p
              className="rounded border bg-muted p-2 text-base"
              data-testid="by-the-way-reply"
            >
              <span className="font-medium">Coach:</span> {questionReply}
            </p>
          )}
        </form>
      </section>

      {!garmin.connected && (
        <p className="text-base text-muted-foreground">
          Connect Garmin in Settings to see your recent activities.
        </p>
      )}
    </section>
  );
}
