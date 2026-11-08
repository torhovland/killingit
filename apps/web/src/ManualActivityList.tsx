import type { ManualActivity } from "@killingit/shared";
import { FormattedText } from "./FormattedText";
import { TrainingLoadLine } from "./TrainingLoadLine";

/** Saved manual activities with their coach reply and edit/delete actions. */
export function ManualActivityList({
  activities,
  onEdit,
  onDelete,
}: {
  activities: ManualActivity[];
  onEdit: (activity: ManualActivity) => void;
  onDelete: (activity: ManualActivity) => Promise<void>;
}) {
  if (activities.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-medium">Saved manual activities</h3>
      <ul className="flex flex-col gap-1">
        {activities.map((activity) => (
          <li
            key={activity.id}
            className="flex items-start justify-between gap-2 rounded border bg-card p-2 text-base"
          >
            <div className="flex flex-col gap-1">
              <span>
                <span className="font-medium">{activity.startDate}</span> —{" "}
                {activity.details}
              </span>
              {activity.coachReply && (
                <div className="flex flex-col gap-1 text-muted-foreground">
                  <span className="font-medium text-foreground">Coach:</span>
                  <FormattedText text={activity.coachReply.text} />
                </div>
              )}
              {activity.trainingLoad !== null &&
                activity.trainingLoad !== undefined && (
                  <TrainingLoadLine
                    load={activity.trainingLoad}
                    tss={activity.estimatedTss ?? undefined}
                    testId="manual-activity-load"
                  />
                )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:underline"
                onClick={() => onEdit(activity)}
              >
                Edit
              </button>
              <button
                type="button"
                className="text-sm text-destructive hover:underline"
                onClick={() => void onDelete(activity)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
