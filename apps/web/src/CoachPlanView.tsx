import { useState } from "react";
import type {
  AthleteEvent,
  CoachPlan,
  DietDaySummary,
  ThresholdSummary,
} from "@killingit/shared";
import {
  AthleteEventList,
  eventsInWeek,
  eventsOn,
} from "./plan/AthleteEventList";
import { BlockSection } from "./plan/BlockSection";
import { DayCard } from "./plan/DayCard";
import { SeasonSection } from "./plan/SeasonSection";
import { WeekSection } from "./plan/WeekSection";

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
 * Each tab lives in its own module under `./plan/`; this file is the shell.
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
  events = [],
  dietToday = null,
  showCalories = false,
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
  /** Dated goals and events the athlete stated, shown on the Day and Week tabs. */
  events?: readonly AthleteEvent[];
  /** Today's logged and needed calories, when diet advice is on. */
  dietToday?: DietDaySummary | null;
  /** Whether the athlete has opted in to diet advice, so diet content is shown. */
  showCalories?: boolean;
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
            <AthleteEventList
              events={eventsOn(events, plan.today.date)}
              testId="plan-today-events"
            />
            <DayCard
              day={plan.today}
              label="Today"
              testId="plan-today"
              refreshing={refreshingDays.today ?? false}
              onDownloadWorkout={onDownloadWorkout}
              downloading={downloadingWorkoutDate === plan.today.date}
              thresholds={thresholds}
              dietToday={dietToday}
              showCalories={showCalories}
            />
            {showTomorrow && plan.tomorrow && (
              <>
                <AthleteEventList
                  events={eventsOn(events, plan.tomorrow.date)}
                  testId="plan-tomorrow-events"
                />
                <DayCard
                  day={plan.tomorrow}
                  label="Tomorrow"
                  testId="plan-tomorrow"
                  refreshing={refreshingDays.tomorrow ?? false}
                  onDownloadWorkout={onDownloadWorkout}
                  downloading={downloadingWorkoutDate === plan.tomorrow.date}
                  thresholds={thresholds}
                  showCalories={showCalories}
                />
              </>
            )}
          </div>
        )}
        {tab === "week" && (
          <div className="flex flex-col gap-4">
            <AthleteEventList
              events={eventsInWeek(events, plan.week.startDate)}
              testId="plan-week-events"
            />
            <WeekSection
              week={plan.week}
              label="This week"
              testId="plan-week"
              refreshing={refreshingWeeks.week ?? false}
              thresholds={thresholds}
              showCalories={showCalories}
            />
            {plan.nextWeek !== null && (
              <>
                <AthleteEventList
                  events={eventsInWeek(events, plan.nextWeek.startDate)}
                  testId="plan-next-week-events"
                />
                <WeekSection
                  week={plan.nextWeek}
                  label="Next week"
                  testId="plan-next-week"
                  refreshing={refreshingWeeks.nextWeek ?? false}
                  thresholds={thresholds}
                  showCalories={showCalories}
                />
              </>
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
              showDiet={showCalories}
            />
            {plan.nextBlock !== null && (
              <BlockSection
                block={plan.nextBlock}
                label="Next block"
                testId="plan-next-block"
                refreshing={refreshingBlocks.nextBlock ?? false}
                thresholds={thresholds}
                showDiet={showCalories}
              />
            )}
          </div>
        )}
        {tab === "season" && (
          <SeasonSection
            season={plan.season}
            thresholds={thresholds}
            showDiet={showCalories}
          />
        )}
      </div>
    </div>
  );
}
