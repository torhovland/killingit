import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachPlan } from "@killingit/shared";
import { CoachPlanView } from "./CoachPlanView";
import { BULLET, noPending, plan } from "../testFixtures/plan";

describe("CoachPlanView levels", () => {
  it("shows an event that falls inside the week on the Week tab", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={plan}
        defaultTab="week"
        events={[
          {
            startDate: "2026-10-23",
            endDate: "2026-10-25",
            title: "Training camp",
            kind: "trip",
          },
          {
            startDate: "2026-11-10",
            endDate: null,
            title: "Later race",
            kind: "race",
          },
        ]}
      />,
    );

    expect(html).toContain('data-testid="plan-week-events"');
    expect(html).toContain("Training camp");
    expect(html).toContain("23–25 Oct 2026");
    expect(html).not.toContain("Later race");
  });

  it("renders the week, block, and season levels with rationales", () => {
    const week = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} defaultTab="week" />,
    );
    expect(week).toContain(`This week${BULLET}Aerobic base`);
    expect(week).toContain("Keep the week easy and consistent.");

    const block = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} defaultTab="block" />,
    );
    expect(block).toContain(`Current block${BULLET}Base`);
    expect(block).toContain("Establish consistent aerobic volume.");

    const season = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} defaultTab="season" />,
    );
    expect(season).toContain(`Season${BULLET}Sub-4-hour marathon`);
    expect(season).toContain(
      "Build a strong aerobic base before marathon-specific work.",
    );
    expect(season).toContain('data-testid="season-goals"');
    expect(season).toContain("Season goals");
    expect(season).toContain("Spring 2027 (A)");
    expect(season).toContain("Sub-4-hour marathon: Under 4:00");
    expect(season).toContain('data-testid="season-block-goals"');
    expect(block).toContain('data-testid="block-goals"');
    expect(block).toContain("Block goals");
    expect(block).toContain("Six consistent weeks of aerobic running");
    expect(block).toContain("(Spring 2027)");
  });

  it("shows the coach's introduction on the Season tab", () => {
    const season = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={{
          ...plan,
          season: {
            ...plan.season,
            introduction:
              "Hello Alex. I am your coach and I look forward to working with you.",
          },
        }}
        defaultTab="season"
      />,
    );

    expect(season).toContain('data-testid="season-introduction"');
    expect(season).toContain(
      "Hello Alex. I am your coach and I look forward to working with you.",
    );
  });

  it("lists block weeks like season blocks, with muted details and rules", () => {
    const block = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} defaultTab="block" />,
    );
    expect(block).toContain("Week 1");
    expect(block).toContain("Week starting Mon, Oct 19");
    expect(block).toContain("Target load: Easy");
    expect(block).toContain("Aerobic base");
    expect(block).toContain("border-b");

    const season = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} defaultTab="season" />,
    );
    expect(season).toContain("1. Base");
    expect(season).toContain("6 weeks");
    expect(season).toContain("Aerobic endurance");
    expect(season).toContain("border-b");
  });

  it("renders the next week and next block after 18:00", () => {
    const nextDates = [
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ];
    const nextPlan: CoachPlan = {
      ...plan,
      nextWeek: {
        ...plan.week,
        startDate: "2026-10-26",
        focus: "Aerobic build",
        rationale: "Start the next week with an easy aerobic block.",
        estimatedFtpWatts: 260,
        sessions: plan.week.sessions.map((session, index) => ({
          ...session,
          date: nextDates[index] ?? session.date,
          title: `Next session ${index + 1}`,
        })),
      },
      nextBlock: {
        ...plan.block,
        name: "Build",
        focus: "Threshold work",
        rationale: "Add threshold work after the aerobic base.",
        startDate: "2026-12-02",
        endDate: "2027-01-15",
      },
    };

    const week = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={nextPlan} defaultTab="week" />,
    );
    expect(week).toContain(`This week${BULLET}Aerobic base`);
    expect(week).toContain(`Next week${BULLET}Aerobic build`);
    expect(week).toContain("Week starting Mon, Oct 26");
    expect(week).toContain("Next session 1");
    expect(week).toContain('data-testid="plan-next-week"');
    expect(week).toContain("260 W");

    const block = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={nextPlan} defaultTab="block" />,
    );
    expect(block).toContain(`Current block${BULLET}Base`);
    expect(block).toContain(`Next block${BULLET}Build`);
    expect(block).toContain("Add threshold work after the aerobic base.");
    expect(block).toContain('data-testid="plan-next-block"');
  });

  it("shows completed and missed sessions for past days", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} defaultTab="week" />,
    );

    expect(html).toContain("Morning Run");
    expect(html).toContain("Completed: running · 10.00 km · 45 min");
    expect(html).toContain("No activity recorded");
    expect(html).toContain("missed");
  });

  it("puts each week session's title right after its date", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} defaultTab="week" />,
    );

    expect(html).toContain(`Mon, Oct 19${BULLET}Morning Run`);
  });

  it("puts the week session details before the status box", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} defaultTab="week" />,
    );

    expect(html.indexOf("45 min")).toBeLessThan(html.indexOf(">completed<"));
  });

  it("lets the week session details wrap above the status box on narrow screens", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} defaultTab="week" />,
    );

    expect(html).toContain(
      'class="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-muted-foreground"',
    );
  });
});
