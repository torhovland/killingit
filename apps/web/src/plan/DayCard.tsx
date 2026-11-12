import {
  activitySport,
  hasExportableBikeWorkout,
  plannedCaloriesKcal,
  sessionSports,
  type DayPlan,
  type DietDaySummary,
  type ThresholdSummary,
} from "@killingit/shared";
import { Bullet } from "../Bullet";
import { CalorieBalancePanel } from "../CalorieBalancePanel";
import { FormattedText } from "../FormattedText";
import { SessionSetting } from "../SessionSetting";
import { TrainingLoadLine } from "../TrainingLoadLine";
import { WeatherSummary } from "../WeatherSummary";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { formatPlanDate } from "./formatPlanDate";
import { RefreshingOverlay, ThresholdsLine } from "./sections";

/**
 * The threshold measures that belong to the day's own sport. A rest day has no
 * sport, so it shows none; a session that names several sports shows each of
 * their measures.
 */
function dayThresholds(
  day: DayPlan,
  thresholds: readonly ThresholdSummary[],
): ThresholdSummary[] {
  if (day.type === "rest") {
    return [];
  }
  const sports = new Set(sessionSports(day.title));
  if (day.bikeWorkout != null) {
    sports.add("cycling");
  }
  return thresholds.filter((entry) => sports.has(activitySport(entry.sport)));
}

/** One fully detailed day, used for today and for tomorrow after 18:00. */
export function DayCard({
  day,
  label,
  testId,
  refreshing = false,
  onDownloadWorkout,
  downloading = false,
  thresholds = [],
  dietToday,
  showCalories = false,
}: {
  day: DayPlan;
  label: string;
  testId: string;
  refreshing?: boolean;
  onDownloadWorkout?: ((date: string) => void) | undefined;
  downloading?: boolean;
  thresholds?: readonly ThresholdSummary[];
  /** Today's logged and needed calories; omitted on days without the panel. */
  dietToday?: DietDaySummary | null;
  showCalories?: boolean;
}) {
  const relevantThresholds = dayThresholds(day, thresholds);
  const dayCalories = plannedCaloriesKcal(day);
  const neededCalories = dietToday?.neededCaloriesKcal ?? dayCalories;
  const calorieBreakdown =
    dietToday?.calorieBreakdown ?? day.calorieBreakdown ?? null;
  return (
    <Card
      as="article"
      variant="inset"
      className="relative flex flex-col gap-2"
      data-testid={testId}
      aria-busy={refreshing || undefined}
    >
      <div
        className={
          refreshing ? "flex flex-col gap-2 opacity-40" : "flex flex-col gap-2"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xl font-semibold">
            {label}
            <Bullet />
            {formatPlanDate(day.date)}
          </h3>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            {(day.status === "completed" || day.status === "partial") && (
              <StatusBadge status={day.status} />
            )}
            <span className="rounded border bg-muted px-2 py-0.5 text-sm capitalize">
              {day.type === "rest" ? (
                "Rest day"
              ) : (
                <>
                  {day.durationMinutes} min
                  <Bullet />
                  {day.intensity}
                  <SessionSetting outdoor={day.outdoor} />
                </>
              )}
            </span>
          </span>
        </div>
        <p className="text-lg font-medium">{day.title}</p>
        {showCalories && dietToday !== undefined ? (
          <CalorieBalancePanel
            neededKcal={neededCalories}
            breakdown={calorieBreakdown}
            consumedKcal={dietToday?.consumedCaloriesKcal ?? null}
            title="Calories today"
            testId={`${testId}-calories`}
          />
        ) : showCalories && dayCalories !== null ? (
          <p className="text-base" data-testid={`${testId}-calories`}>
            <span className="font-medium">Estimated calories: </span>
            {dayCalories} kcal
          </p>
        ) : null}
        {day.trainingLoad !== null && day.trainingLoad !== undefined && (
          <TrainingLoadLine load={day.trainingLoad} testId={`${testId}-load`} />
        )}
        {day.type === "workout" &&
          day.canBeOutdoor !== false &&
          (day.weather != null || day.forecasts != null) && (
            <WeatherSummary weather={day.weather} forecasts={day.forecasts} />
          )}
        <FormattedText
          text={day.description}
          className="text-base text-muted-foreground"
          testId={`${testId}-description`}
        />
        {relevantThresholds.length > 0 && (
          <ThresholdsLine
            thresholds={relevantThresholds}
            testId={`${testId}-thresholds`}
          />
        )}
        {day.type === "workout" && day.bikeWorkout != null && (
          <div className="flex flex-col gap-1" data-testid={`${testId}-ftp`}>
            <p className="text-base">
              <span className="font-medium">Workout FTP: </span>
              {day.bikeWorkout.ftpWatts} W
            </p>
            <p className="text-sm text-muted-foreground">
              Set this FTP in Zwift or another trainer app so the downloaded
              power zones match.
            </p>
          </div>
        )}
        {onDownloadWorkout !== undefined && hasExportableBikeWorkout(day) && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="disabled:opacity-60"
              onClick={() => onDownloadWorkout?.(day.date)}
              disabled={downloading}
              data-testid={`${testId}-download`}
            >
              {downloading
                ? "Preparing workout file…"
                : "Download workout file (.zwo)"}
            </Button>
            <span className="text-sm text-muted-foreground">
              For Zwift or another trainer app.
            </span>
          </div>
        )}
        {day.alternatives.length > 0 && (
          <div className="text-base">
            <p className="font-medium">Alternatives</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {day.alternatives.map((alternative) => (
                <li key={alternative}>{alternative}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-1 text-base">
          <p className="font-medium">Coach's rationale</p>
          <FormattedText
            text={day.rationale}
            className="text-muted-foreground"
            testId={`${testId}-rationale`}
          />
        </div>
        {day.type === "workout" && day.optionalRationale && (
          <div
            className="rounded border bg-muted p-3 text-base"
            data-testid={`${testId}-optionality`}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="font-medium">Why this session matters</p>
              <span className="rounded border bg-background px-1.5 py-0.5 text-sm text-muted-foreground">
                {day.optional ? "Optional session" : "Do not skip this session"}
              </span>
            </div>
            <FormattedText
              text={day.optionalRationale}
              className="mt-1 text-muted-foreground"
              testId={`${testId}-optional-rationale`}
            />
          </div>
        )}
      </div>
      {refreshing && (
        <RefreshingOverlay
          label={`${label.toLowerCase()}'s`}
          testId={`${testId}-refreshing`}
        />
      )}
    </Card>
  );
}
