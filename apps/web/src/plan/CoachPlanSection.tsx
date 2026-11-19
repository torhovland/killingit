import { useAppStatus } from "../AppStatus";
import { useAuth } from "../auth";
import { CoachPlanView } from "./CoachPlanView";
import { useNavigate } from "../navigation";
import { PlanProgress } from "./PlanProgress";
import { SubmitButton } from "../SubmitButton";
import { useCoachPlan } from "./useCoachPlan";
import { usePlanWorkoutDownload } from "./usePlanWorkoutDownload";
import { useTimeZone } from "../TimeZoneContext";
import { formatDateTime } from "../timeZone";
import { Button } from "../components/Button";
import { Card } from "../components/Card";

interface CoachPlanSectionProps {
  /** Increment after answers are saved so the section regenerates the plan. */
  refreshKey: number;
  /** Garmin and OpenRouter must both be configured to generate a plan. */
  ready: boolean;
  /** Whether the athlete wants the food log and its calorie panel. */
  dietAdvice?: boolean;
  /** Called when a generation finishes, so activity analyses can be reloaded. */
  onGenerated?: () => void;
}

/**
 * The four-level coach plan. `useCoachPlan` loads the stored plan and decides
 * whether to track or start a generation, `usePlanWorkoutDownload` owns the
 * workout file, and this component renders the card. Generation and polling
 * live in `PlanGenerationProvider`, so the header spinner keeps reporting the
 * run on every page. The old plan stays visible during a regeneration, except
 * on the Day, Week, and Block tabs where a superseded level is greyed out until
 * its replacement arrives.
 */
export function CoachPlanSection({
  refreshKey,
  ready,
  dietAdvice = false,
  onGenerated,
}: CoachPlanSectionProps) {
  const auth = useAuth();
  const { status } = useAppStatus();
  const navigate = useNavigate();
  const timeZone = useTimeZone();
  const plan = useCoachPlan(auth, timeZone, {
    refreshKey,
    ready,
    dietAdvice,
    onGenerated,
  });
  const download = usePlanWorkoutDownload(auth);

  if (!auth.isAuthenticated) {
    return null;
  }

  const planError = plan.error ?? download.error;

  return (
    <Card
      as="section"
      className="flex w-full flex-col gap-4 text-left"
      data-testid="coach-plan"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">Your plan</h2>
          <p className="text-base text-muted-foreground">
            {plan.data?.generatedAt
              ? `Generated ${formatDateTime(plan.data.generatedAt, timeZone)}`
              : "Your coach builds the season, block, week, and today from your profile and recent training."}
          </p>
        </div>
      </div>

      {!ready && (
        <Card
          variant="inset"
          className="flex flex-wrap items-center justify-between gap-2 rounded p-3 text-base"
        >
          <span className="text-muted-foreground">
            Connect Garmin and OpenRouter to generate your training plan.
          </span>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => navigate("settings")}
          >
            Open settings
          </Button>
        </Card>
      )}

      {planError && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-destructive" data-testid="plan-error">
            Error: {planError}
          </p>
          {!plan.running && (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => void plan.start("auto")}
            >
              Try again
            </Button>
          )}
        </div>
      )}

      {plan.setupError && !plan.running && (
        <Card
          variant="inset"
          className="flex flex-wrap items-center justify-between gap-2 rounded p-3 text-base"
          data-testid="plan-generation-error"
        >
          <p className="text-destructive">
            The coach could not finish your plan: {plan.setupError}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void plan.start("auto")}
          >
            Try again
          </Button>
        </Card>
      )}

      <PlanProgress
        progress={plan.progress}
        status={plan.running ? "thinking" : status}
      />

      {plan.loading && plan.data === null && (
        <p
          className="text-base text-muted-foreground"
          data-testid="plan-loading"
        >
          Loading your plan…
        </p>
      )}

      {plan.data?.plan ? (
        <CoachPlanView
          plan={plan.data.plan}
          pending={plan.data.pending}
          running={plan.running}
          showTomorrow={plan.showTomorrow}
          onDownloadWorkout={download.downloadWorkout}
          downloadingWorkoutDate={download.downloadingDate}
          thresholds={plan.data.thresholds}
          events={plan.data.events}
          {...(dietAdvice ? { dietToday: plan.dietToday } : {})}
          showCalories={dietAdvice}
        />
      ) : (
        !plan.loading &&
        ready && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-base text-muted-foreground">
              No plan yet. Your coach will build it from your profile and recent
              training.
            </p>
            <SubmitButton
              type="button"
              busy={plan.running}
              variant="primary"
              size="md"
              onClick={() => void plan.start("auto")}
            >
              {plan.running ? "Coach is thinking…" : "Generate my plan"}
            </SubmitButton>
          </div>
        )
      )}
    </Card>
  );
}
