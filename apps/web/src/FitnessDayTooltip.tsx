import { formatActivityType, type FitnessHistoryDay } from "@killingit/shared";
import { Bullet } from "./Bullet";
import { formatChartDate } from "./chartGeometry";
import { TrainingLoadLine } from "./TrainingLoadLine";

/**
 * The hover card for one day of the fitness chart: the day's load numbers and
 * the activities the athlete logged that day.
 */
export function FitnessDayTooltip({
  day,
  today,
}: {
  day: FitnessHistoryDay;
  /** The athlete's current date; later days read as plans, not history. */
  today: string;
}) {
  const planned = day.planned;
  const isRest = planned?.type === "rest";
  const isFuture = day.date > today;

  return (
    <div className="flex flex-col gap-1" data-testid="fitness-tooltip">
      <p className="text-base font-medium">{formatChartDate(day.date)}</p>
      <TrainingLoadLine load={day} />
      {day.activities.length === 0 && planned !== null ? (
        isRest && !isFuture ? (
          // A rest day that has arrived (or passed) is history, not a plan.
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Rest</span>
          </p>
        ) : (
          <p className="text-muted-foreground">
            Planned:{" "}
            <span className="font-medium text-foreground">
              {isRest ? "Rest" : planned.title}
            </span>
            {isRest ? (
              ""
            ) : (
              <>
                <Bullet />
                {planned.durationMinutes} min
              </>
            )}
          </p>
        )
      ) : day.activities.length === 0 ? (
        <p className="text-muted-foreground">No activities recorded</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {day.activities.map((activity) => (
            <li key={activity.id} className="truncate">
              <span className="font-medium">{activity.name}</span>{" "}
              <span className="text-muted-foreground">
                {formatActivityType(activity.type)}
                {activity.durationMinutes !== undefined && (
                  <>
                    <Bullet />
                    {formatDuration(activity.durationMinutes)}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Minutes as `45 min` or `1 h 20`. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}
