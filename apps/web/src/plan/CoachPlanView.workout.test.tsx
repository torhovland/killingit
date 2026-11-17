import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachPlan } from "@killingit/shared";
import { CoachPlanView } from "./CoachPlanView";
import { noPending, plan } from "../testFixtures/plan";

describe("CoachPlanView workouts", () => {
  it("offers a workout-file download for indoor bike power sessions", () => {
    const bikeWorkout = {
      ftpWatts: 250,
      intervals: [
        { durationSeconds: 600, powerPercent: 55 },
        { durationSeconds: 480, powerPercent: 90 },
      ],
    };
    const bikePlan: CoachPlan = {
      ...plan,
      today: {
        ...plan.today,
        title: "Sweet spot",
        outdoor: false,
        canBeOutdoor: false,
        bikeWorkout,
      },
      tomorrow: {
        ...(plan.tomorrow ?? plan.today),
        title: "Tempo blocks",
        outdoor: false,
        canBeOutdoor: false,
        bikeWorkout,
      },
    };

    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={bikePlan}
        showTomorrow
        onDownloadWorkout={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="plan-today-download"');
    expect(html).toContain('data-testid="plan-tomorrow-download"');
    expect(html).toContain('data-testid="plan-today-ftp"');
    expect(html).toContain('data-testid="plan-tomorrow-ftp"');
    expect(html).toContain("Workout FTP:");
    expect(html).toContain("250 W");
    expect(html).toContain("Set this FTP in Zwift or another trainer app");
    expect(html).toContain("Download workout file (.zwo)");
    expect(html).toContain("For Zwift or another trainer app.");
  });

  it("shows no estimated FTP when the session has no structured power targets", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} />,
    );

    expect(html).not.toContain('data-testid="plan-today-ftp"');
    expect(html).not.toContain("Workout FTP:");
  });

  it("hides the download when the session is not an indoor power workout", () => {
    const bikeWorkout = {
      ftpWatts: 250,
      intervals: [{ durationSeconds: 600, powerPercent: 55 }],
    };
    const outdoor = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={{
          ...plan,
          today: { ...plan.today, outdoor: true, bikeWorkout },
        }}
        onDownloadWorkout={() => undefined}
      />,
    );
    expect(outdoor).not.toContain('data-testid="plan-today-download"');
    // The estimated FTP still helps even when this instance is ridden outside.
    expect(outdoor).toContain('data-testid="plan-today-ftp"');

    const noTargets = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={{ ...plan, today: { ...plan.today, outdoor: false } }}
        onDownloadWorkout={() => undefined}
      />,
    );
    expect(noTargets).not.toContain('data-testid="plan-today-download"');

    const withoutHandler = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={{
          ...plan,
          today: { ...plan.today, outdoor: false, bikeWorkout },
        }}
      />,
    );
    expect(withoutHandler).not.toContain('data-testid="plan-today-download"');
  });

  it("disables the download button while the file is prepared", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={{
          ...plan,
          today: {
            ...plan.today,
            outdoor: false,
            bikeWorkout: {
              ftpWatts: 250,
              intervals: [{ durationSeconds: 600, powerPercent: 55 }],
            },
          },
        }}
        onDownloadWorkout={() => undefined}
        downloadingWorkoutDate={plan.today.date}
      />,
    );

    expect(html).toContain("Preparing workout file…");
    expect(html).toContain("disabled");
  });
});
