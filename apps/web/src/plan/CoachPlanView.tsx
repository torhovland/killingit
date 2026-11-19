import { useState } from "react";
import type {
  AthleteEvent,
  CoachPlan,
  DietDaySummary,
  PlanPending,
  ThresholdSummary,
} from "@killingit/shared";
import { Tabs, type TabEntry } from "../components/Tabs";
import { AthleteEventList, eventsInWeek, eventsOn } from "./AthleteEventList";
import { BlockSection } from "./BlockSection";
import { DayCard } from "./DayCard";
import { SeasonSection } from "./SeasonSection";
import { WeekSection } from "./WeekSection";

export type PlanTab = "day" | "week" | "block" | "season";

/**
 * Presentational four-level plan in a tabbed view. Day is the default tab and
 * shows today's session plus tomorrow's after 18:00. Kept separate from the
 * fetching/progress container so it can be rendered and tested without auth.
 * The plan's `pending` levels and the provider's `running` flag decide which
 * level is dimmed while its replacement is in flight. Each tab lives in its own
 * module in this directory; this file is the shell.
 */
export function CoachPlanView({
  plan,
  pending,
  running = false,
  showTomorrow = false,
  defaultTab = "day",
  onDownloadWorkout,
  downloadingWorkoutDate = null,
  thresholds = [],
  events = [],
  dietToday = null,
  showCalories = false,
}: {
  plan: CoachPlan;
  /** The levels the stored plan is missing or has outdated. */
  pending: PlanPending;
  /** Whether a generation is running, so a pending level is being replaced. */
  running?: boolean;
  showTomorrow?: boolean;
  defaultTab?: PlanTab;
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
  const refreshing = {
    day: running && pending.day,
    tomorrow: running && pending.tomorrow,
    week: running && pending.week,
    nextWeek: running && pending.nextWeek,
    block: running && pending.block,
    nextBlock: running && pending.nextBlock,
  };

  const tabs: Array<TabEntry<PlanTab>> = [
    {
      id: "day",
      label: "Day",
      content: (
        <div className="flex flex-col gap-4">
          <AthleteEventList
            events={eventsOn(events, plan.today.date)}
            testId="plan-today-events"
          />
          <DayCard
            day={plan.today}
            label="Today"
            testId="plan-today"
            refreshing={refreshing.day}
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
                refreshing={refreshing.tomorrow}
                onDownloadWorkout={onDownloadWorkout}
                downloading={downloadingWorkoutDate === plan.tomorrow.date}
                thresholds={thresholds}
                showCalories={showCalories}
              />
            </>
          )}
        </div>
      ),
    },
    {
      id: "week",
      label: "Week",
      content: (
        <div className="flex flex-col gap-4">
          <AthleteEventList
            events={eventsInWeek(events, plan.week.startDate)}
            testId="plan-week-events"
          />
          <WeekSection
            week={plan.week}
            label="This week"
            testId="plan-week"
            refreshing={refreshing.week}
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
                refreshing={refreshing.nextWeek}
                thresholds={thresholds}
                showCalories={showCalories}
              />
            </>
          )}
        </div>
      ),
    },
    {
      id: "block",
      label: "Block",
      content: (
        <div className="flex flex-col gap-4">
          <BlockSection
            block={plan.block}
            label="Current block"
            testId="plan-block"
            refreshing={refreshing.block}
            thresholds={thresholds}
            showDiet={showCalories}
          />
          {plan.nextBlock !== null && (
            <BlockSection
              block={plan.nextBlock}
              label="Next block"
              testId="plan-next-block"
              refreshing={refreshing.nextBlock}
              thresholds={thresholds}
              showDiet={showCalories}
            />
          )}
        </div>
      ),
    },
    {
      id: "season",
      label: "Season",
      content: (
        <SeasonSection
          season={plan.season}
          thresholds={thresholds}
          showDiet={showCalories}
        />
      ),
    },
  ];

  return (
    <Tabs
      label="Plan levels"
      tabs={tabs}
      value={tab}
      onChange={setTab}
      className="flex flex-col gap-4"
      testId="coach-plan-view"
    />
  );
}
