import { describe, expect, it } from "bun:test";
import { buildFtpTimelineFromPoints, ftpAt, ftpBaselineAt } from "./ftp.js";

describe("buildFtpTimelineFromPoints", () => {
  const points = [
    { date: "2026-10-01", value: 240, source: "user" as const },
    { date: "2026-10-10", value: 250, source: "coach" as const },
    { date: "2026-10-20", value: 260, source: "user" as const },
  ];

  it("interpolates between stored points and marks user values as measurements", () => {
    const timeline = buildFtpTimelineFromPoints(points);

    expect(ftpAt(timeline, "2026-10-05")).toBe(244);
    expect(timeline.latest).toEqual({ watts: 260, fromRevision: true });
  });

  it("excludes values dated after the reference day", () => {
    const timeline = buildFtpTimelineFromPoints(points, "2026-10-10");

    expect(timeline.latest).toEqual({ watts: 250, fromRevision: false });
    expect(ftpBaselineAt(timeline, "2026-10-20")).toEqual({
      watts: 250,
      fromRevision: false,
    });
  });

  it("keeps a user value when a coach estimate shares its date", () => {
    const timeline = buildFtpTimelineFromPoints([
      { date: "2026-10-10", value: 250, source: "user" },
      { date: "2026-10-10", value: 300, source: "coach" },
    ]);

    expect(timeline.latest).toEqual({ watts: 250, fromRevision: true });
  });

  it("keeps a garmin measurement when it shares a date with a coach estimate", () => {
    const timeline = buildFtpTimelineFromPoints([
      { date: "2026-10-10", value: 265, source: "garmin" },
      { date: "2026-10-10", value: 300, source: "coach" },
    ]);

    expect(timeline.latest).toEqual({ watts: 265, fromRevision: true });
  });

  it("interpolates a revised test through the weeks before it", () => {
    const timeline = buildFtpTimelineFromPoints([
      { date: "2026-01-01", value: 200, source: "user" },
      { date: "2026-01-31", value: 240, source: "user" },
    ]);

    expect(ftpAt(timeline, "2026-01-01")).toBe(200);
    expect(ftpAt(timeline, "2026-01-16")).toBe(220);
    expect(ftpAt(timeline, "2026-01-31")).toBe(240);
    expect(ftpAt(timeline, "2026-02-10")).toBe(240);
    expect(timeline.latest).toEqual({ watts: 240, fromRevision: true });
  });

  it("has no anchors when the athlete has stated no FTP", () => {
    const timeline = buildFtpTimelineFromPoints([]);

    expect(timeline.anchors).toEqual([]);
    expect(timeline.latest).toBeNull();
    expect(ftpAt(timeline, "2026-10-20")).toBeNull();
    expect(ftpBaselineAt(timeline, "2026-10-20")).toBeNull();
  });

  it("lets a later coach estimate supersede an earlier one", () => {
    const timeline = buildFtpTimelineFromPoints([
      { date: "2026-10-01", value: 250, source: "coach" },
      { date: "2026-10-15", value: 258, source: "coach" },
    ]);

    expect(timeline.latest).toEqual({ watts: 258, fromRevision: false });
  });

  it("reports the measurement when the athlete retests after a projection", () => {
    const timeline = buildFtpTimelineFromPoints([
      { date: "2026-10-01", value: 250, source: "coach" },
      { date: "2026-10-12", value: 268, source: "user" },
    ]);

    expect(timeline.latest).toEqual({ watts: 268, fromRevision: true });
    expect(ftpBaselineAt(timeline, "2026-10-11")).toEqual({
      watts: 250,
      fromRevision: false,
    });
  });
});
