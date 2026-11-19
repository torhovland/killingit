import {
  activityAverageSpeed,
  formatActivityPaceOrSpeed,
  formatActivityType,
  formatDuration,
  type ActivitySummary,
} from "@killingit/shared";
import { formatDistanceKm } from "../formatDistance";
import { formatDateTime } from "../timeZone";

/** The activity fields the metadata line renders. */
type ActivityMetadataSource = Pick<
  ActivitySummary,
  | "startDate"
  | "type"
  | "distance"
  | "movingTime"
  | "elapsedTime"
  | "totalElevationGain"
  | "averageSpeed"
  | "averagePower"
  | "normalizedPower"
>;

/**
 * The detail line both the activity card and the calendar dialog show: when it
 * started in the athlete's zone, its type, and the recorded distance, pace or
 * speed, duration, climb and power. Each part is omitted when the activity has
 * no value for it, so an indoor session does not claim a distance or a climb.
 */
export function activityMetadata(
  activity: ActivityMetadataSource,
  timeZone: string,
): string[] {
  const metadata = [
    formatDateTime(activity.startDate, timeZone),
    formatActivityType(activity.type),
  ];
  if (activity.distance > 0) {
    metadata.push(formatDistanceKm(activity.distance));
  }
  const averageSpeed = activityAverageSpeed(activity);
  if (averageSpeed !== null) {
    const paceOrSpeed = formatActivityPaceOrSpeed(activity.type, averageSpeed);
    if (paceOrSpeed !== null) {
      metadata.push(paceOrSpeed);
    }
  }
  metadata.push(formatDuration(activity.elapsedTime));
  if (activity.totalElevationGain > 0) {
    metadata.push(`${Math.round(activity.totalElevationGain)} m climb`);
  }
  if (activity.averagePower != null && activity.averagePower > 0) {
    metadata.push(`${Math.round(activity.averagePower)} W average`);
  }
  if (activity.normalizedPower != null && activity.normalizedPower > 0) {
    metadata.push(`${Math.round(activity.normalizedPower)} W normalized`);
  }
  return metadata;
}
