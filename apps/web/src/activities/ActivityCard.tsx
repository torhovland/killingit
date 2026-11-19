import { useState } from "react";
import { hasLapStructure, type AnalyzedActivity } from "@killingit/shared";
import { ActivityMap } from "./ActivityMap";
import { ActivityLaps } from "./ActivityLaps";
import { ActivitySamples } from "./ActivitySamples";
import { activityMetadata } from "./activityMetadata";
import { Bullet, Bullets } from "../Bullet";
import { CommentSection } from "../CommentSection";
import { FormattedText } from "../FormattedText";
import { TrainingLoadLine } from "../TrainingLoadLine";
import { useCommentForm } from "../useCommentForm";
import { useTimeZone } from "../TimeZoneContext";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { CoachReply } from "../components/CoachReply";
import { ConfirmDialog } from "../components/ConfirmDialog";

/**
 * One synced activity with its coach analysis and program review.
 * Presentational only so it can be rendered and tested without any data
 * fetching. When `onSubmitComment` is provided, the card offers a comment box
 * for activities without a comment, and an edit action for the single comment
 * an activity may have. Saving a comment feeds the next plan revision and the
 * coach replies immediately.
 */
export function ActivityCard({
  activity,
  onSubmitComment,
  onNoComment,
  onDelete,
}: {
  activity: AnalyzedActivity;
  onSubmitComment?: (
    activityId: string,
    comment: string,
    mode: "create" | "edit",
  ) => Promise<string | null>;
  onNoComment?: (activityId: string) => Promise<void>;
  onDelete?: (activityId: string) => Promise<void>;
}) {
  const timeZone = useTimeZone();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const commentForm = useCommentForm({
    storedComment: activity.comment,
    storedReply: activity.coachReply?.text ?? null,
    onSubmit:
      onSubmitComment === undefined
        ? undefined
        : (comment, mode) =>
            onSubmitComment(String(activity.id), comment, mode),
    onDismiss:
      onNoComment === undefined
        ? undefined
        : () => onNoComment(String(activity.id)),
    dismissErrorMessage: "Could not mark the activity",
  });

  async function handleDelete(): Promise<void> {
    if (!onDelete || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(String(activity.id));
      setConfirming(false);
    } catch (err: unknown) {
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete activity",
      );
    } finally {
      setDeleting(false);
    }
  }

  // Activity-comment replies are written by the background run, so the comment
  // can be saved before the reply exists. Keep the coach's side of the
  // conversation visible with a thinking placeholder until the reply arrives.
  const awaitingReply =
    commentForm.shownComment !== null && commentForm.shownReply === null;
  // Plan fit is part of the coach summary, not its own section. The general
  // analysis is the current review; an older stored program review is only a
  // fallback for activities that predate the single-review prompt.
  const summary =
    activity.analysis?.text.trim() || activity.programAnalysis?.text.trim();
  const route = activity.route ?? [];
  const hasMap = route.length >= 2;
  const metadata = activityMetadata(activity, timeZone);

  return (
    <Card
      as="article"
      className="flex flex-col gap-2 text-left"
      data-testid="activity-card"
    >
      <div
        className={
          hasMap
            ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-start"
            : "flex flex-col gap-2"
        }
      >
        <div className="flex flex-col gap-2">
          <header className="flex flex-col gap-1">
            <h3 className="text-xl font-semibold">{activity.name}</h3>
            <p className="text-base text-muted-foreground">
              <Bullets parts={metadata} />
              {onDelete && (
                <>
                  <Bullet />
                  <Button
                    type="button"
                    variant="link"
                    size="none"
                    className="text-destructive"
                    onClick={() => {
                      setDeleteError(null);
                      setConfirming(true);
                    }}
                    disabled={deleting}
                    data-testid="activity-delete"
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </Button>
                </>
              )}
            </p>
          </header>

          {deleteError && !confirming && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}

          {activity.trainingLoad !== null &&
            activity.trainingLoad !== undefined && (
              <TrainingLoadLine
                load={activity.trainingLoad}
                tss={activity.activityTss ?? undefined}
                testId="activity-load"
              />
            )}

          {summary ? (
            <FormattedText text={summary} testId="activity-analysis" />
          ) : (
            <p
              className="rounded bg-accent/15 p-2 text-base"
              data-testid="activity-analysis-error"
            >
              {activity.analysisError
                ? `Coach analysis unavailable: ${activity.analysisError}`
                : "No coach analysis available yet."}
            </p>
          )}
        </div>
        {hasMap && <ActivityMap route={route} />}
      </div>

      {activity.samples.length > 0 && (
        <ActivitySamples
          samples={activity.samples}
          sampleCount={activity.sampleCount}
          activityType={activity.type}
        />
      )}

      {hasLapStructure(activity.laps) && (
        <ActivityLaps laps={activity.laps} activityType={activity.type} />
      )}

      <CommentSection
        form={commentForm}
        editable={onSubmitComment !== undefined}
        testIdPrefix="activity"
        textareaId={`activity-comment-${activity.id}`}
        ariaLabel="Comment about this activity"
        placeholder="How did it feel? Anything the coach should know?"
      >
        {commentForm.shownReply !== null ? (
          <CoachReply
            text={commentForm.shownReply}
            testId="activity-coach-reply"
          />
        ) : awaitingReply ? (
          <p
            className="text-base text-muted-foreground"
            data-testid="activity-coach-reply-pending"
            aria-live="polite"
          >
            <span className="font-medium text-foreground">Coach:</span>{" "}
            thinking…
          </p>
        ) : null}
      </CommentSection>

      {confirming && (
        <ConfirmDialog
          title="Delete this activity?"
          description="It disappears from your coaching view; its comment and coach reply are removed and the plan is revised."
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={deleting}
          error={deleteError}
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Card>
  );
}
