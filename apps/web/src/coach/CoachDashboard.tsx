import { useCallback, useEffect, useState } from "react";
import { selectPendingActivities } from "../activities/pendingActivities";
import { PendingActivitiesSection } from "../activities/PendingActivitiesSection";
import { useActivityFeed } from "../activities/useActivityFeed";
import { useAppStatus } from "../AppStatus";
import { useAuth } from "../auth";
import { CoachPlanSection } from "../plan/CoachPlanSection";
import { CoachQuestionCard } from "./CoachQuestionCard";
import { CoachingInputsSection } from "./CoachingInputsSection";
import { pollCoachReplies } from "./coachReplyPoll";
import { useCurrentUser } from "../CurrentUserProvider";
import { FoodLogSection } from "../diet/FoodLogSection";
import { DailyMeasurementsSection } from "../measurements/DailyMeasurementsSection";
import { PendingReviewsList } from "./PendingReviewsList";
import { useTimeZone } from "../TimeZoneContext";
import { useCoachQuestion } from "./useCoachQuestion";
import { useCoachReviews } from "./useCoachReviews";
import { useStatuses } from "../useStatuses";
import { Button } from "../components/Button";

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
  const { user } = useCurrentUser();
  const dietAdvice = user?.dietAdvice ?? false;
  const { setStatus } = useAppStatus();
  const timeZone = useTimeZone();
  const statuses = useStatuses(auth);
  // Commented-on activities stay on the page for this visit. The server feed
  // omits them once they have been answered; a reload clears the kept set.
  const feed = useActivityFeed(auth, timeZone, { keepAnswered: true });
  // Destructured so the effects below can depend on the callbacks themselves;
  // the feed object is rebuilt on every render.
  const { loadCached, loadAnalyses, awaitingReplies } = feed;
  const [localPlanRefresh, setLocalPlanRefresh] = useState(0);
  const bumpPlan = useCallback(
    () => setLocalPlanRefresh((value) => value + 1),
    [],
  );
  const reviews = useCoachReviews(auth, timeZone, bumpPlan);
  const coachQuestion = useCoachQuestion(auth, timeZone, bumpPlan);

  useEffect(() => {
    setStatus("dashboard-status", statuses.loading ? "loading" : null);
    return () => setStatus("dashboard-status", null);
  }, [statuses.loading, setStatus]);

  useEffect(() => {
    setStatus("dashboard-activities", feed.syncing ? "syncing" : null);
    return () => setStatus("dashboard-activities", null);
  }, [feed.syncing, setStatus]);

  useEffect(() => {
    if (!statuses.garmin?.connected) {
      return;
    }
    void loadCached();
    void loadAnalyses();
  }, [
    statuses.garmin?.connected,
    statuses.llm?.configured,
    loadCached,
    loadAnalyses,
  ]);

  // The coach stores replies before it starts the slower plan refresh, so poll
  // the cached feed while any comment is still waiting for its reply. The poll
  // waits for each response before asking again, so slow answers cannot stack.
  useEffect(() => {
    if (!auth.isAuthenticated || !awaitingReplies) {
      return;
    }
    let active = true;
    void pollCoachReplies({ loadCached, isActive: () => active });
    return () => {
      active = false;
    };
  }, [auth, awaitingReplies, loadCached]);

  if (!auth.isAuthenticated) {
    return null;
  }

  const errorMessage =
    reviews.error ?? coachQuestion.error ?? feed.error ?? statuses.error;

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
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={() => void statuses.reload()}
        >
          Retry
        </Button>
      </section>
    );
  }

  const pendingActivities = feed.data
    ? selectPendingActivities(feed.data.activities, feed.keptActivityIds)
    : [];
  const ready = statuses.garmin.connected && statuses.llm.configured;

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      {errorMessage && (
        <p className="text-destructive" data-testid="coach-error">
          Error: {errorMessage}
        </p>
      )}

      <FoodLogSection enabled={dietAdvice} onLogged={bumpPlan} />

      <DailyMeasurementsSection />

      {coachQuestion.question !== null && (
        <section className="flex flex-col gap-3" data-testid="coach-question">
          <CoachQuestionCard
            question={coachQuestion.question}
            onSubmitAnswer={coachQuestion.answer}
          />
        </section>
      )}

      {statuses.garmin.connected && (
        <PendingActivitiesSection
          activities={pendingActivities}
          onSubmitComment={feed.submitComment}
          onNoComment={feed.markNoComment}
          onDelete={feed.deleteActivity}
        />
      )}

      <PendingReviewsList
        reviews={reviews.pending}
        onSubmitComment={reviews.submitComment}
        onNoComment={reviews.markNoComment}
      />

      <CoachPlanSection
        refreshKey={planRefreshKey + localPlanRefresh + feed.revision}
        ready={ready}
        dietAdvice={dietAdvice}
        onGenerated={() => {
          void feed.loadAnalyses();
          void reviews.load();
          void coachQuestion.load();
        }}
      />

      <CoachingInputsSection onWeeklyNoteSaved={bumpPlan} />

      {!statuses.garmin.connected && (
        <p className="text-base text-muted-foreground">
          Connect Garmin in Settings to see your recent activities.
        </p>
      )}
    </section>
  );
}
