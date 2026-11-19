import type { AnalyzedActivity } from "@killingit/shared";
import { ActivityList } from "./ActivityList";

/** Activities on the dashboard that still need a comment or acknowledgement. */
export function PendingActivitiesSection({
  activities,
  onSubmitComment,
  onNoComment,
  onDelete,
}: {
  activities: AnalyzedActivity[];
  onSubmitComment: (
    activityId: string,
    comment: string,
    mode: "create" | "edit",
  ) => Promise<string | null>;
  onNoComment: (activityId: string) => Promise<void>;
  onDelete: (activityId: string) => Promise<void>;
}) {
  if (activities.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3" data-testid="pending-activities">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">Recent activities</h2>
        <p className="text-base text-muted-foreground">
          Add a comment, or mark it with no comment.
        </p>
      </div>
      <ActivityList
        activities={activities}
        onSubmitComment={onSubmitComment}
        onNoComment={onNoComment}
        onDelete={onDelete}
      />
    </section>
  );
}
