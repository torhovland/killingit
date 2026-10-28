import { describe, expect, it } from "bun:test";
import {
  buildFtpTimeline,
  buildFtpTimelineFromPoints,
  detectFtpBaseline,
  extractFtpWatts,
  firstFtpInText,
  ftpAt,
  ftpBaselineAt,
} from "./ftp.js";

describe("extractFtpWatts", () => {
  it("reads the first stated FTP from the answers", () => {
    expect(
      extractFtpWatts([
        { answer: "I ride a lot but have no numbers yet." },
        { answer: "My current FTP is around 220 W, roughly 280 W when fit." },
      ]),
    ).toBe(220);
  });

  it("supports the common phrasings", () => {
    expect(firstFtpInText("FTP: 250")).toBe(250);
    expect(firstFtpInText("FTP around 280W.")).toBe(280);
    expect(firstFtpInText("Threshold is 280 W FTP.")).toBe(280);
    expect(firstFtpInText("ftp of 190 watts")).toBe(190);
    expect(firstFtpInText("Threshold test today: 245 W.")).toBe(245);
  });

  it("ignores numbers without an FTP label and implausible values", () => {
    expect(firstFtpInText("I ran 10 km in 45 minutes.")).toBeNull();
    expect(firstFtpInText("FTP 5000 W")).toBeNull();
    expect(firstFtpInText("FTP 4.5 W/kg")).toBeNull();
  });

  it("returns null when the athlete skipped every answer", () => {
    expect(extractFtpWatts([{ answer: null }, { answer: "   " }])).toBeNull();
  });
});

describe("detectFtpBaseline", () => {
  const answers = [{ answer: "Current FTP is around 220 W." }];

  it("uses the latest revised test from an activity comment", () => {
    const baseline = detectFtpBaseline({
      answers,
      answersUpdatedAt: new Date("2026-10-01T10:00:00Z"),
      activityComments: [
        {
          activityId: "1",
          comment: "FTP test today: 260 W, up from 220.",
          updatedAt: "2026-10-20T18:00:00Z",
        },
      ],
    });

    expect(baseline).toEqual({ watts: 260, fromRevision: true });
  });

  it("uses the profile when the answers were updated after the mention", () => {
    const baseline = detectFtpBaseline({
      answers,
      answersUpdatedAt: new Date("2026-10-25T10:00:00Z"),
      activityComments: [
        {
          activityId: "1",
          comment: "FTP test today: 260 W.",
          updatedAt: "2026-10-20T18:00:00Z",
        },
      ],
    });

    expect(baseline).toEqual({ watts: 220, fromRevision: false });
  });

  it("picks the newest mention across comments, notes, and manual entries", () => {
    const baseline = detectFtpBaseline({
      answers: [],
      activityComments: [
        {
          activityId: "1",
          comment: "FTP 250 W after the test.",
          updatedAt: "2026-10-10T10:00:00Z",
        },
      ],
      weeklyNote: "Did an FTP test: 265 W this week.",
      weeklyNoteUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      manualActivities: [
        {
          id: 1,
          startDate: "2026-10-22",
          details: "FTP test on the trainer: 270 W.",
          updatedAt: "2026-10-22T12:00:00Z",
        },
      ],
    });

    expect(baseline).toEqual({ watts: 270, fromRevision: true });
  });

  it("interpolates between the profile date and a later test", () => {
    const timeline = buildFtpTimeline({
      answers: [
        {
          answer: "FTP is 200 W.",
          answeredAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      activityComments: [
        {
          activityId: "1",
          comment: "FTP test today: 240 W.",
          updatedAt: "2026-01-31T00:00:00Z",
        },
      ],
    });

    expect(ftpAt(timeline, "2026-01-01")).toBe(200);
    expect(ftpAt(timeline, "2026-01-16")).toBe(220);
    expect(ftpAt(timeline, "2026-01-31")).toBe(240);
    expect(ftpAt(timeline, "2026-02-10")).toBe(240);
    expect(timeline.latest).toEqual({ watts: 240, fromRevision: true });
  });

  it("keeps the profile when it was answered after the mention", () => {
    const timeline = buildFtpTimeline({
      answers: [
        {
          answer: "FTP is 230 W.",
          answeredAt: new Date("2026-02-01T10:00:00Z"),
        },
      ],
      activityComments: [
        {
          activityId: "1",
          comment: "FTP test: 210 W.",
          updatedAt: "2026-01-01T10:00:00Z",
        },
      ],
    });

    expect(timeline.latest).toEqual({ watts: 230, fromRevision: false });
  });

  it("keeps the profile flat when the answer has no date", () => {
    const timeline = buildFtpTimeline({
      answers: [{ answer: "FTP is 200 W." }],
      activityComments: [
        {
          activityId: "1",
          comment: "FTP test: 240 W.",
          updatedAt: "2026-01-31T10:00:00Z",
        },
      ],
    });

    expect(ftpAt(timeline, "2026-01-15")).toBe(200);
    expect(ftpAt(timeline, "2026-02-01")).toBe(240);
  });

  it("enables the estimate when the mention is the only FTP source", () => {
    expect(
      detectFtpBaseline({
        answers: [],
        periodReviews: [
          {
            kind: "week",
            title: "Week 1",
            startDate: "2026-10-19",
            endDate: "2026-10-25",
            summary: "Good week.",
            comment: "I retested and my FTP is now 245 W.",
            reply: null,
            updatedAt: "2026-10-25T18:00:00Z",
          },
        ],
      }),
    ).toEqual({ watts: 245, fromRevision: true });
  });
});

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
});
