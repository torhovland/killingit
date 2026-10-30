import { useState, type ReactNode } from "react";
import {
  formatThresholdValue,
  hasExportableBikeWorkout,
  type BlockPlan,
  type CoachPlan,
  type DayPlan,
  type SeasonPlan,
  type ThresholdSummary,
  type WeekPlan,
  type WeekSessionStatus,
} from "@killingit/shared";
import { Bullet } from "./Bullet";
import { SessionSetting } from "./SessionSetting";
import { TrainingLoadLine } from "./TrainingLoadLine";
import { WeatherSummary } from "./WeatherSummary";

export type PlanTab = "day" | "week" | "block" | "season";

const TABS: Array<{ id: PlanTab; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "block", label: "Block" },
  { id: "season", label: "Season" },
];

/**
 * Presentational four-level plan in a tabbed view. Day is the default tab and
 * shows today's session plus tomorrow's after 18:00. Kept separate from the
 * fetching/progress container so it can be rendered and tested without auth.
 */
export function CoachPlanView({
  plan,
  showTomorrow = false,
  defaultTab = "day",
  refreshingDays = {},
  refreshingWeeks = {},
  refreshingBlocks = {},
  onDownloadWorkout,
  downloadingWorkoutDate = null,
  thresholds = [],
}: {
  plan: CoachPlan;
  showTomorrow?: boolean;
  defaultTab?: PlanTab;
  /** Days whose stored content is being replaced by a generation in flight. */
  refreshingDays?: { today?: boolean; tomorrow?: boolean };
  /** Weeks whose stored content is being replaced by a generation in flight. */
  refreshingWeeks?: { week?: boolean; nextWeek?: boolean };
  /** Blocks whose stored content is being replaced by a generation in flight. */
  refreshingBlocks?: { block?: boolean; nextBlock?: boolean };
  /** Starts a download of the structured workout for a date. */
  onDownloadWorkout?: (date: string) => void;
  /** The date whose workout file is currently being prepared. */
  downloadingWorkoutDate?: string | null;
  /** Every threshold measure currently known about the athlete. */
  thresholds?: readonly ThresholdSummary[];
}) {
  const [tab, setTab] = useState<PlanTab>(defaultTab);

  return (
    <div className="flex flex-col gap-4" data-testid="coach-plan-view">
      <div
        className="flex flex-wrap gap-1"
        role="tablist"
        aria-label="Plan levels"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className="rounded border bg-inset px-3 py-1 text-base aria-[selected=true]:border-transparent aria-[selected=true]:bg-primary aria-[selected=true]:text-primary-foreground"
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "day" && (
          <div className="flex flex-col gap-4">
            <DayCard
              day={plan.today}
              label="Today"
              testId="plan-today"
              refreshing={refreshingDays.today ?? false}
              onDownloadWorkout={onDownloadWorkout}
              downloading={downloadingWorkoutDate === plan.today.date}
              thresholds={thresholds}
            />
            {showTomorrow && plan.tomorrow && (
              <DayCard
                day={plan.tomorrow}
                label="Tomorrow"
                testId="plan-tomorrow"
                refreshing={refreshingDays.tomorrow ?? false}
                onDownloadWorkout={onDownloadWorkout}
                downloading={downloadingWorkoutDate === plan.tomorrow.date}
                thresholds={thresholds}
              />
            )}
          </div>
        )}
        {tab === "week" && (
          <div className="flex flex-col gap-4">
            <WeekSection
              week={plan.week}
              label="This week"
              testId="plan-week"
              refreshing={refreshingWeeks.week ?? false}
              thresholds={thresholds}
            />
            {plan.nextWeek !== null && (
              <WeekSection
                week={plan.nextWeek}
                label="Next week"
                testId="plan-next-week"
                refreshing={refreshingWeeks.nextWeek ?? false}
                thresholds={thresholds}
              />
            )}
          </div>
        )}
        {tab === "block" && (
          <div className="flex flex-col gap-4">
            <BlockSection
              block={plan.block}
              label="Current block"
              testId="plan-block"
              refreshing={refreshingBlocks.block ?? false}
              thresholds={thresholds}
            />
            {plan.nextBlock !== null && (
              <BlockSection
                block={plan.nextBlock}
                label="Next block"
                testId="plan-next-block"
                refreshing={refreshingBlocks.nextBlock ?? false}
                thresholds={thresholds}
              />
            )}
          </div>
        )}
        {tab === "season" && (
          <SeasonSection season={plan.season} thresholds={thresholds} />
        )}
      </div>
    </div>
  );
}

function DayCard({
  day,
  label,
  testId,
  refreshing = false,
  onDownloadWorkout,
  downloading = false,
  thresholds = [],
}: {
  day: DayPlan;
  label: string;
  testId: string;
  refreshing?: boolean;
  onDownloadWorkout?: ((date: string) => void) | undefined;
  downloading?: boolean;
  thresholds?: readonly ThresholdSummary[];
}) {
  return (
    <article
      className="relative flex flex-col gap-2 rounded-lg border bg-inset p-4"
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
          <span className="flex items-center gap-2">
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
        {day.trainingLoad !== null && day.trainingLoad !== undefined && (
          <TrainingLoadLine load={day.trainingLoad} testId={`${testId}-load`} />
        )}
        {day.type === "workout" &&
          day.canBeOutdoor !== false &&
          (day.weather != null || day.forecasts != null) && (
            <WeatherSummary weather={day.weather} forecasts={day.forecasts} />
          )}
        <p className="whitespace-pre-line text-base text-muted-foreground">
          {day.description}
        </p>
        {thresholds.length > 0 && (
          <ThresholdsLine
            thresholds={thresholds}
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
            <button
              type="button"
              className="rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted disabled:opacity-60"
              onClick={() => onDownloadWorkout?.(day.date)}
              disabled={downloading}
              data-testid={`${testId}-download`}
            >
              {downloading
                ? "Preparing workout file…"
                : "Download workout file (.zwo)"}
            </button>
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
        <p className="text-base">
          <span className="font-medium">Coach's rationale: </span>
          <span className="text-muted-foreground">{day.rationale}</span>
        </p>
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
            <p className="mt-1 text-muted-foreground">
              {day.optionalRationale}
            </p>
          </div>
        )}
      </div>
      {refreshing && (
        <RefreshingOverlay
          label={`${label.toLowerCase()}'s`}
          testId={`${testId}-refreshing`}
        />
      )}
    </article>
  );
}

/** Dimmed overlay shown while a plan level is being replaced in flight. */
function RefreshingOverlay({
  label,
  testId,
}: {
  /** Possessive name of the level, such as `today's` or `this week's`. */
  label: string;
  testId: string;
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-inset/60"
      data-testid={testId}
    >
      <span
        className="inline-flex size-6 animate-spin rounded-full border-2 border-current border-t-transparent text-primary"
        role="status"
        aria-label={`Updating ${label} plan`}
      />
      <span className="text-base text-muted-foreground">
        Updating {label} plan…
      </span>
    </div>
  );
}

function WeekSection({
  week,
  label,
  testId,
  refreshing = false,
  thresholds = [],
}: {
  week: WeekPlan;
  label: string;
  testId?: string;
  refreshing?: boolean;
  thresholds?: readonly ThresholdSummary[];
}) {
  const estimatedFtp = week.estimatedFtpWatts;
  return (
    <section
      className="relative rounded-lg border bg-inset p-4"
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
        <p className="mt-2 text-base text-muted-foreground">{week.rationale}</p>
        <ul className="mt-3 flex flex-col gap-2">
          {week.sessions.map((session) => (
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
                <p className="w-full text-sm text-muted-foreground">
                  {session.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
      {refreshing && (
        <RefreshingOverlay
          label={`${label.toLowerCase()}'s`}
          testId={`${testId ?? "plan-week"}-refreshing`}
        />
      )}
    </section>
  );
}

/** The athlete's known threshold measures in a compact, inline list. */
function ThresholdsLine({
  thresholds,
  testId,
  inline = false,
}: {
  thresholds: readonly ThresholdSummary[];
  testId: string;
  /** True when the line sits inside an existing paragraph. */
  inline?: boolean;
}) {
  const content = (
    <span data-testid={testId}>
      <Bullet />
      <span className="font-medium">Thresholds: </span>
      {thresholds.map((entry, index) => (
        <span key={`${entry.sport}:${entry.measure}`}>
          {index > 0 && <Bullet />}
          {entry.sport} {entry.label}{" "}
          <span className="font-medium">
            {formatThresholdValue(entry.value, entry.unit, entry.kind)}
          </span>
        </span>
      ))}
    </span>
  );
  return inline ? content : <p className="text-base">{content}</p>;
}

function StatusBadge({ status }: { status: WeekSessionStatus }) {
  return (
    <span className="rounded border bg-muted px-2 py-0.5 text-sm capitalize">
      {status}
    </span>
  );
}

function BlockSection({
  block,
  label,
  testId,
  refreshing = false,
  thresholds = [],
}: {
  block: BlockPlan;
  label: string;
  testId?: string;
  refreshing?: boolean;
  thresholds?: readonly ThresholdSummary[];
}) {
  const estimatedFtp = block.estimatedFtpWatts;
  return (
    <section
      className="relative rounded-lg border bg-inset p-4"
      data-testid={testId}
      aria-busy={refreshing || undefined}
    >
      <div
        className={refreshing ? "flex flex-col opacity-40" : "flex flex-col"}
      >
        <h3 className="text-xl font-semibold">
          {label}
          <Bullet />
          {block.name}
        </h3>
        <p className="mt-2 text-base text-muted-foreground">
          {formatPlanDate(block.startDate)} → {formatPlanDate(block.endDate)}
          {thresholds.length > 0 ? (
            <ThresholdsLine
              thresholds={thresholds}
              testId="block-thresholds"
              inline
            />
          ) : (
            estimatedFtp != null && (
              <span data-testid="block-ftp">
                <Bullet />
                Estimated FTP:{" "}
                <span className="font-medium">{estimatedFtp} W</span>
              </span>
            )
          )}
        </p>
        <p className="mt-3 text-base text-muted-foreground">{block.focus}</p>
        <p className="mt-3 text-base">
          <span className="font-medium">Coach's rationale: </span>
          <span className="text-muted-foreground">{block.rationale}</span>
        </p>
        <PlanList>
          {block.weeks.map((week) => (
            <PlanListItem key={`${week.number}-${week.startDate}`}>
              <p className="font-medium">Week {week.number}</p>
              <p className="text-muted-foreground">
                Week starting {formatPlanDate(week.startDate)}
              </p>
              <p className="text-muted-foreground">
                Target load: {week.targetLoad}
              </p>
              {week.estimatedFtpWatts != null && (
                <p className="text-muted-foreground">
                  Estimated FTP: {week.estimatedFtpWatts} W
                </p>
              )}
              <p className="text-muted-foreground">{week.focus}</p>
            </PlanListItem>
          ))}
        </PlanList>
      </div>
      {refreshing && (
        <RefreshingOverlay
          label={`${label.toLowerCase()}'s`}
          testId={`${testId ?? "plan-block"}-refreshing`}
        />
      )}
    </section>
  );
}

function SeasonSection({
  season,
  thresholds = [],
}: {
  season: SeasonPlan;
  thresholds?: readonly ThresholdSummary[];
}) {
  const estimatedFtp = season.estimatedFtpWatts;
  return (
    <section className="rounded-lg border bg-inset p-4">
      <h3 className="text-xl font-semibold">
        Season
        <Bullet />
        {season.goal}
      </h3>
      <p className="mt-2 text-base text-muted-foreground">
        {formatPlanDate(season.startDate)} → {formatPlanDate(season.endDate)}
        {thresholds.length > 0 ? (
          <ThresholdsLine
            thresholds={thresholds}
            testId="season-thresholds"
            inline
          />
        ) : (
          estimatedFtp != null && (
            <span data-testid="season-ftp">
              <Bullet />
              Estimated FTP:{" "}
              <span className="font-medium">{estimatedFtp} W</span>
            </span>
          )
        )}
      </p>
      <p className="mt-3 text-base">
        <span className="font-medium">Coach's rationale: </span>
        <span className="text-muted-foreground">{season.rationale}</span>
      </p>
      <PlanList>
        {season.blocks.map((block, index) => (
          <PlanListItem key={`${block.name}-${block.startDate}`}>
            <p className="font-medium">
              {index + 1}. {block.name}
            </p>
            <p className="text-muted-foreground">
              {formatPlanDate(block.startDate)} →{" "}
              {formatPlanDate(block.endDate)}
              <Bullet />
              {block.weekCount} {block.weekCount === 1 ? "week" : "weeks"}
            </p>
            <p className="text-muted-foreground">{block.focus}</p>
          </PlanListItem>
        ))}
      </PlanList>
    </section>
  );
}

/** List shared by the block and season views, with the Week tab's rules. */
function PlanList({ children }: { children: ReactNode }) {
  return <ol className="mt-4 flex flex-col gap-3 text-base">{children}</ol>;
}

function PlanListItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0">
      {children}
    </li>
  );
}

export function formatPlanDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
