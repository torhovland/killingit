import {
  activityAverageSpeed,
  formatActivityPaceOrSpeed,
  formatActivityType,
  formatDuration,
  type CalendarActivity,
  type WeekSession,
} from "@killingit/shared";
import { ActivityMap } from "../ActivityMap";
import { Bullet, Bullets } from "../Bullet";
import { FormattedText } from "../FormattedText";
import { SessionSetting } from "../SessionSetting";
import { TrainingLoadLine } from "../TrainingLoadLine";
import { useTimeZone } from "../TimeZoneContext";
import { formatDistanceKm } from "../formatDistance";
import { formatPlanDate } from "../plan/formatPlanDate";
import { formatDateTime } from "../timeZone";
import { WeatherSummary } from "../WeatherSummary";
import { Button } from "../components/Button";
import { CoachReply } from "../components/CoachReply";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import type { CalendarSelection } from "./selection";

/** The full details of the selected activity or planned session. */
export function CalendarEntryDialog({
  selection,
  onClose,
}: {
  selection: CalendarSelection | null;
  onClose: () => void;
}) {
  if (selection === null) {
    return null;
  }

  return (
    <Modal
      labelledBy="calendar-entry-title"
      onClose={onClose}
      className="max-h-full max-w-2xl overflow-y-auto"
      testId="calendar-entry-dialog"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id="calendar-entry-title" className="text-xl font-semibold">
          {selection.kind === "activity" ? (
            selection.activity.name
          ) : (
            <>
              {formatPlanDate(selection.session.date)}
              <Bullet />
              {selection.session.title}
            </>
          )}
        </h3>
        <Button type="button" variant="secondary" size="xs" onClick={onClose}>
          Close
        </Button>
      </div>

      {selection.kind === "activity" ? (
        <ActivityDetails activity={selection.activity} />
      ) : (
        <SessionDetails session={selection.session} />
      )}
    </Modal>
  );
}

function ActivityDetails({ activity }: { activity: CalendarActivity }) {
  const timeZone = useTimeZone();

  if (activity.source === "manual") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-base text-muted-foreground">
          Manual activity
          <Bullet />
          {formatPlanDate(activity.startDate)}
        </p>
        <p className="whitespace-pre-line">{activity.details}</p>
        {activity.estimatedTss != null && (
          <p className="text-base">
            <span className="font-medium">Estimated TSS: </span>
            {Math.round(activity.estimatedTss)}
          </p>
        )}
        {activity.trainingLoad != null && (
          <TrainingLoadLine
            load={activity.trainingLoad}
            testId="calendar-dialog-load"
          />
        )}
        {activity.coachReply && (
          <CoachReply
            text={activity.coachReply.text}
            testId="calendar-dialog-coach-reply"
          />
        )}
      </div>
    );
  }

  const route = activity.route ?? [];
  const hasMap = route.length >= 2;
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
  const summary =
    activity.analysis?.text.trim() ||
    activity.programAnalysis?.text.trim() ||
    "";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-muted-foreground">
        <Bullets parts={metadata} />
      </p>

      {hasMap ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-start">
          <div className="flex flex-col gap-2">
            <ActivitySummaryDetails activity={activity} summary={summary} />
          </div>
          <ActivityMap route={route} />
        </div>
      ) : (
        <ActivitySummaryDetails activity={activity} summary={summary} />
      )}

      {activity.comment && (
        <p className="text-base" data-testid="calendar-dialog-comment">
          <span className="font-medium">You:</span> {activity.comment}
        </p>
      )}
      {activity.coachReply && (
        <CoachReply
          text={activity.coachReply.text}
          testId="calendar-dialog-coach-reply"
        />
      )}
    </div>
  );
}

function ActivitySummaryDetails({
  activity,
  summary,
}: {
  activity: Extract<CalendarActivity, { source: "garmin" }>;
  summary: string;
}) {
  return (
    <>
      {activity.trainingLoad != null && (
        <TrainingLoadLine
          load={activity.trainingLoad}
          tss={activity.activityTss ?? undefined}
          testId="calendar-dialog-load"
        />
      )}
      {summary ? (
        <FormattedText text={summary} />
      ) : (
        <p className="rounded bg-accent/15 p-2 text-base">
          {activity.analysisError
            ? `Coach analysis unavailable: ${activity.analysisError}`
            : "No coach analysis available yet."}
        </p>
      )}
    </>
  );
}

function SessionDetails({ session }: { session: WeekSession }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2 text-base text-muted-foreground">
        <span>{formatPlanDate(session.date)}</span>
        <StatusBadge status={session.status} />
        <span>
          {session.type === "rest" ? (
            "Rest day"
          ) : (
            <>
              {session.durationMinutes} min
              <Bullet />
              {session.intensity}
              <SessionSetting outdoor={session.outdoor} />
            </>
          )}
        </span>
      </p>
      {session.trainingLoad != null && (
        <TrainingLoadLine
          load={session.trainingLoad}
          testId="calendar-dialog-load"
        />
      )}
      {session.type === "workout" &&
        session.canBeOutdoor !== false &&
        (session.weather != null || session.forecasts != null) && (
          <WeatherSummary
            weather={session.weather}
            forecasts={session.forecasts}
          />
        )}
      <FormattedText
        text={session.description}
        className="text-base text-muted-foreground"
      />
      {session.type === "workout" &&
        session.trainingLoad == null &&
        session.estimatedTss != null && (
          <p className="text-base">
            <span className="font-medium">Estimated TSS: </span>
            {Math.round(session.estimatedTss)}
          </p>
        )}
    </div>
  );
}
