import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnalyzedActivity } from "@killingit/shared";
import { ActivityCard } from "./ActivityCard";
import { TimeZoneProvider } from "./TimeZoneContext";

const activity: AnalyzedActivity = {
  id: 1,
  name: "Morning Run",
  type: "indoor_cycling",
  startDate: "2026-10-01T06:30:00Z",
  distance: 5000,
  movingTime: 1500,
  elapsedTime: 1600,
  totalElevationGain: 55,
  sampleCount: 1,
  analysis: {
    text: "You held a steady aerobic effort.",
    model: "openrouter/auto",
    generatedAt: "2026-10-01T07:00:00Z",
  },
  analysisError: null,
  programAnalysis: null,
  comment: null,
  coachReply: null,
};

describe("ActivityCard", () => {
  it("renders the activity summary and coach analysis", () => {
    const html = renderToStaticMarkup(<ActivityCard activity={activity} />);

    expect(html).toContain("Morning Run");
    expect(html).toContain("Indoor cycling");
    expect(html).toContain("5.00 km");
    expect(html).toContain("55 m climb");
    expect(html).toContain("26:40");
    expect(html).not.toContain("sample");
    expect(html).toContain("You held a steady aerobic effort.");
    expect(html).not.toContain("openrouter/auto");
  });

  it("shows the day's training load when it is available", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{
          ...activity,
          trainingLoad: { tss: 85, atl: 29, ctl: 20, tsb: -20 },
        }}
      />,
    );

    expect(html).toContain('data-testid="activity-load"');
    expect(html).toContain("TSS 85");
    expect(html).toContain("ATL 29");
    expect(html).toContain("CTL 20");
    expect(html).toContain("TSB -20");
    expect(html).toContain("Productive");
  });

  it("omits the training load when it is not available", () => {
    const html = renderToStaticMarkup(<ActivityCard activity={activity} />);

    expect(html).not.toContain('data-testid="activity-load"');
    expect(html).not.toContain("TSS");
  });

  it("renders the analysis error when generation failed", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{
          ...activity,
          analysis: null,
          analysisError: "OpenRouter is unavailable",
        }}
      />,
    );

    expect(html).toContain("Coach analysis unavailable");
    expect(html).toContain("OpenRouter is unavailable");
  });

  it("renders a fallback when no analysis exists yet", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{ ...activity, analysis: null, analysisError: null }}
      />,
    );

    expect(html).toContain("No coach analysis available yet.");
  });

  it("keeps the plan fit inside the summary and shows the comment and reply", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{
          ...activity,
          programAnalysis: {
            text: "The effort fit the base block, but the finish was too hard.",
            model: "openrouter/auto",
            generatedAt: "2026-10-01T07:05:00Z",
          },
          comment: "Felt strong on the hills.",
          coachReply: {
            text: "Good work; I will keep Thursday easy.",
            model: "openrouter/auto",
            generatedAt: "2026-10-01T07:06:00Z",
          },
        }}
      />,
    );

    expect(html).not.toContain('data-testid="activity-program-analysis"');
    expect(html).not.toContain("How it fit your plan");
    expect(html).toContain("The effort fit the base block");
    expect(html).toContain("Felt strong on the hills.");
    expect(html).toContain('data-testid="activity-coach-reply"');
    expect(html).toContain("I will keep Thursday easy.");
  });

  it("uses elapsed time and omits zero distance and climb", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{ ...activity, distance: 0, totalElevationGain: 0 }}
      />,
    );

    expect(html).toContain("26:40");
    expect(html).not.toContain("0.00 km");
    expect(html).not.toContain("0 m climb");
  });

  it("renders a route map when position data is available", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{
          ...activity,
          route: [
            { latitude: 59.91, longitude: 10.75 },
            { latitude: 59.92, longitude: 10.76 },
            { latitude: 59.93, longitude: 10.77 },
          ],
        }}
      />,
    );

    expect(html).toContain('data-testid="activity-map"');
    expect(html).toContain("Activity route map");
    expect(html).toContain("tile.openstreetmap.org");
    expect(html).toContain("OpenStreetMap contributors");
    expect(html).toContain("text-background");
    expect(html).toContain("aspect-square");
    expect(html).not.toContain("Route · start to finish");
  });

  it("puts the delete action at the end of the metadata line, left of the map", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{
          ...activity,
          route: [
            { latitude: 59.91, longitude: 10.75 },
            { latitude: 59.92, longitude: 10.76 },
          ],
        }}
        onDelete={() => Promise.resolve()}
      />,
    );

    expect(html.indexOf('data-testid="activity-delete"')).toBeGreaterThan(
      html.indexOf("Indoor cycling"),
    );
    expect(html.indexOf('data-testid="activity-delete"')).toBeLessThan(
      html.indexOf('data-testid="activity-map"'),
    );
  });

  it("does not render a map without position data", () => {
    const html = renderToStaticMarkup(<ActivityCard activity={activity} />);

    expect(html).not.toContain('data-testid="activity-map"');
  });

  it("formats the start time in the selected time zone", () => {
    const oslo = renderToStaticMarkup(
      <TimeZoneProvider timeZone="Europe/Oslo">
        <ActivityCard activity={activity} />
      </TimeZoneProvider>,
    );
    const utc = renderToStaticMarkup(
      <TimeZoneProvider timeZone="UTC">
        <ActivityCard activity={activity} />
      </TimeZoneProvider>,
    );

    expect(oslo).toContain("08:30");
    expect(utc).toContain("06:30");
  });

  it("renders a comment form when a submit handler is provided", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={activity}
        onSubmitComment={() => Promise.resolve(null)}
      />,
    );

    expect(html).toContain('data-testid="activity-comment-form"');
    expect(html).toContain("Send to coach");
    expect(html).not.toContain("Add a comment about this activity");
    expect(html).not.toContain("border-t pt-2");
  });

  it("offers to edit an existing comment instead of adding another", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{ ...activity, comment: "Felt strong on the hills." }}
        onSubmitComment={() => Promise.resolve(null)}
      />,
    );

    expect(html).toContain('data-testid="activity-comment-edit"');
    expect(html).toContain("Edit comment");
    expect(html).not.toContain('data-testid="activity-comment-form"');
    expect(html).not.toContain("Send to coach");
  });

  it("does not offer editing without a submit handler", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{ ...activity, comment: "Felt strong on the hills." }}
      />,
    );

    expect(html).not.toContain('data-testid="activity-comment-edit"');
    expect(html).toContain("Felt strong on the hills.");
  });

  it("renders a no-comment action only when a handler is provided", () => {
    const withNoComment = renderToStaticMarkup(
      <ActivityCard
        activity={activity}
        onSubmitComment={() => Promise.resolve(null)}
        onNoComment={() => Promise.resolve()}
      />,
    );
    const withoutNoComment = renderToStaticMarkup(
      <ActivityCard
        activity={activity}
        onSubmitComment={() => Promise.resolve(null)}
      />,
    );

    expect(withNoComment).toContain('data-testid="activity-no-comment"');
    expect(withNoComment).toContain("No comment");
    expect(withoutNoComment).not.toContain('data-testid="activity-no-comment"');

    const alreadyCommented = renderToStaticMarkup(
      <ActivityCard
        activity={{ ...activity, comment: "Felt strong on the hills." }}
        onSubmitComment={() => Promise.resolve(null)}
        onNoComment={() => Promise.resolve()}
      />,
    );
    expect(alreadyCommented).not.toContain('data-testid="activity-no-comment"');
  });

  it("renders a delete action only when a delete handler is provided", () => {
    const withDelete = renderToStaticMarkup(
      <ActivityCard activity={activity} onDelete={() => Promise.resolve()} />,
    );
    const withoutDelete = renderToStaticMarkup(
      <ActivityCard activity={activity} />,
    );

    expect(withDelete).toContain('data-testid="activity-delete"');
    expect(withoutDelete).not.toContain('data-testid="activity-delete"');
  });

  it("omits the comment form when no submit handler is provided", () => {
    const html = renderToStaticMarkup(<ActivityCard activity={activity} />);

    expect(html).not.toContain('data-testid="activity-comment-form"');
    expect(html).not.toContain("Add a comment about this activity");
  });
});
