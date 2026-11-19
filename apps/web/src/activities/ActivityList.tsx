import type { AnalyzedActivity } from "@killingit/shared";
import { ActivityCard } from "./ActivityCard";

/**
 * A list of activity cards. The dashboard uses it for activities that still
 * need attention; the Activities page uses it for the whole feed.
 */
export function ActivityList({
  activities,
  emptyMessage,
  onSubmitComment,
  onNoComment,
  onDelete,
}: {
  activities: AnalyzedActivity[];
  /** Shown when the list is empty and the caller wants an empty state. */
  emptyMessage?: string | undefined;
  onSubmitComment?:
    | ((
        activityId: string,
        comment: string,
        mode: "create" | "edit",
      ) => Promise<string | null>)
    | undefined;
  onNoComment?: ((activityId: string) => Promise<void>) | undefined;
  onDelete?: ((activityId: string) => Promise<void>) | undefined;
}) {
  if (activities.length === 0) {
    return emptyMessage === undefined ? null : (
      <p className="text-base text-muted-foreground">{emptyMessage}</p>
    );
  }

  const handlers = {
    ...(onSubmitComment ? { onSubmitComment } : {}),
    ...(onNoComment ? { onNoComment } : {}),
    ...(onDelete ? { onDelete } : {}),
  };

  return (
    <>
      {activities.map((activity) => (
        <ActivityCard key={activity.id} activity={activity} {...handlers} />
      ))}
    </>
  );
}
