import {
  plannedCaloriesKcal,
  type ThresholdSummary,
  type WeekPlan,
} from "@killingit/shared";
import { Bullet } from "../Bullet";
import { FormattedText } from "../FormattedText";
import { SessionSetting } from "../SessionSetting";
import { TrainingLoadLine } from "../TrainingLoadLine";
import { WeatherSummary } from "../WeatherSummary";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { formatPlanDate } from "./formatPlanDate";
import {
  DietProgressLine,
  RefreshingOverlay,
  ThresholdsLine,
} from "./sections";

/** One week's outline: focus, rationale, and a line for each session. */
export function WeekSection({
  week,
  label,
  testId,
  refreshing = false,
  thresholds = [],
  showCalories = false,
}: {
  week: WeekPlan;
  label: string;
  testId?: string;
  refreshing?: boolean;
  thresholds?: readonly ThresholdSummary[];
  showCalories?: boolean;
}) {
  const estimatedFtp = week.estimatedFtpWatts;
  return (
    <Card
      as="section"
      variant="inset"
      className="relative"
      data-testid={testId}
      aria-busy={refreshing || undefined}
    >
      <div
        className={refreshing ? "flex flex-col opacity-40" : "flex flex-col"}
      >
        <h3 className="text-xl font-semibold">
          {label}
          <Bullet />
          {week.focus}
        </h3>
        <p className="text-base text-muted-foreground">
          Week starting {formatPlanDate(week.startDate)}
          {thresholds.length > 0 ? (
            <ThresholdsLine
              thresholds={thresholds}
              testId="week-thresholds"
              inline
            />
          ) : (
            estimatedFtp != null && (
              <span data-testid="week-ftp">
                <Bullet />
                Estimated FTP:{" "}
                <span className="font-medium">{estimatedFtp} W</span>
              </span>
            )
          )}
        </p>
        <FormattedText
          text={week.rationale}
          className="mt-2 text-base text-muted-foreground"
          testId="week-rationale"
        />
        {showCalories && week.dietProgress != null && (
          <DietProgressLine
            progress={week.dietProgress}
            period="the week"
            testId="week-diet-progress"
          />
        )}
        <ul className="mt-3 flex flex-col gap-2">
          {week.sessions.map((session) => {
            const calories = plannedCaloriesKcal(session);
            return (
              <li
                key={session.date}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 text-base last:border-b-0 last:pb-0"
              >
                <span className="font-medium">
                  {formatPlanDate(session.date)}
                  <Bullet />
                  {session.title}
                </span>
                <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-muted-foreground">
                  {session.type !== "rest" && (
                    <span>
                      {session.status === "completed" &&
                      session.durationMinutes === 0 ? (
                        "Logged manually"
                      ) : (
                        <>
                          {session.durationMinutes} min
                          <Bullet />
                          {session.intensity}
                          <SessionSetting outdoor={session.outdoor} />
                        </>
                      )}
                    </span>
                  )}
                  <StatusBadge status={session.status} />
                  {showCalories && calories !== null && (
                    <span data-testid="week-session-calories">
                      {calories} kcal needed
                    </span>
                  )}
                </span>
                {session.trainingLoad !== null &&
                  session.trainingLoad !== undefined && (
                    <TrainingLoadLine
                      load={session.trainingLoad}
                      testId="session-load"
                    />
                  )}
                {session.type === "workout" &&
                  session.canBeOutdoor !== false &&
                  (session.weather != null || session.forecasts != null) && (
                    <div className="w-full" data-testid="week-weather">
                      <WeatherSummary
                        weather={session.weather}
                        forecasts={session.forecasts}
                      />
                    </div>
                  )}
                {session.description.trim() !== "" && (
                  <FormattedText
                    text={session.description}
                    className="w-full text-sm text-muted-foreground"
                    testId="week-session-description"
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {refreshing && (
        <RefreshingOverlay
          label={`${label.toLowerCase()}'s`}
          testId={`${testId ?? "plan-week"}-refreshing`}
        />
      )}
    </Card>
  );
}
