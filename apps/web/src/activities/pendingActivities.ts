import type { AnalyzedActivity } from "@killingit/shared";

/**
 * Activities that still need the athlete's attention on the main page. An
 * activity commented on during this visit stays visible until the page is
 * reloaded, even if a later feed reload reports that it now has a comment.
 */
export function selectPendingActivities(
  activities: readonly AnalyzedActivity[],
  keptForVisit: ReadonlySet<string> = new Set(),
): AnalyzedActivity[] {
  return activities.filter(
    (activity) =>
      keptForVisit.has(String(activity.id)) ||
      (activity.comment === null && !activity.reviewed),
  );
}
