import { describe, expect, it } from "bun:test";
import type { GarminDailyResponse } from "@killingit/shared";
import { GarminSidecarError } from "./client.js";
import { planDailySyncDates, syncGarminDailyHistory } from "./dailySync.js";

const credentials = { username: "u", password: "p" };

describe("planDailySyncDates", () => {
  it("refreshes today and yesterday even when they are watermarked", () => {
    const dates = planDailySyncDates({
      today: "2026-11-02",
      windowStart: "2026-10-30",
      synced: new Set(["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-30"]),
    });

    expect(dates).toEqual(["2026-11-02", "2026-11-01"]);
  });

  it("adds a missing older date and skips watermarked neighbours", () => {
    const dates = planDailySyncDates({
      today: "2026-11-02",
      windowStart: "2026-10-30",
      synced: new Set(["2026-10-31"]),
    });

    expect(dates).toEqual(["2026-11-02", "2026-11-01", "2026-10-30"]);
  });

  it("walks the whole window on the first pass", () => {
    const dates = planDailySyncDates({
      today: "2026-11-02",
      windowStart: "2026-10-28",
      synced: new Set(),
    });

    expect(dates).toHaveLength(6);
    expect(dates[0]).toBe("2026-11-02");
    expect(dates[dates.length - 1]).toBe("2026-10-28");
  });
});

describe("syncGarminDailyHistory", () => {
  it("stores each day and writes its watermark", async () => {
    const saved: GarminDailyResponse[] = [];
    const marked: string[] = [];

    const result = await syncGarminDailyHistory(
      {
        userId: 1,
        credentials,
        today: "2026-11-02",
        windowDays: 3,
      },
      {
        loadSyncedDates: () => Promise.resolve(new Set(["2026-10-31"])),
        fetchDay: (_credentials, date) =>
          Promise.resolve({ date, metrics: { resting_heart_rate: 52 } }),
        saveDay: (_userId, response) => {
          saved.push(response);
          return Promise.resolve();
        },
        markSynced: (_userId, date) => {
          marked.push(date);
          return Promise.resolve();
        },
      },
    );

    expect(result).toEqual({
      fetched: ["2026-11-02", "2026-11-01", "2026-10-30"],
      rateLimited: false,
      failedDate: null,
    });
    expect(saved.map((response) => response.date)).toEqual([
      "2026-11-02",
      "2026-11-01",
      "2026-10-30",
    ]);
    expect(marked).toEqual(["2026-11-02", "2026-11-01", "2026-10-30"]);
  });

  it("stops on a Garmin rate limit and keeps earlier watermarks", async () => {
    const marked: string[] = [];
    const result = await syncGarminDailyHistory(
      {
        userId: 1,
        credentials,
        today: "2026-11-02",
        windowDays: 3,
      },
      {
        loadSyncedDates: () => Promise.resolve(new Set()),
        fetchDay: (_credentials, date) => {
          if (date === "2026-11-01") {
            return Promise.reject(new GarminSidecarError("rate limit", 429));
          }
          return Promise.resolve({ date, metrics: {} });
        },
        saveDay: () => Promise.resolve(),
        markSynced: (_userId, date) => {
          marked.push(date);
          return Promise.resolve();
        },
      },
    );

    expect(result).toEqual({
      fetched: ["2026-11-02"],
      rateLimited: true,
      failedDate: null,
    });
    expect(marked).toEqual(["2026-11-02"]);
  });

  it("stops on a non-rate-limit failure without marking the failed day", async () => {
    const result = await syncGarminDailyHistory(
      {
        userId: 1,
        credentials,
        today: "2026-11-02",
        windowDays: 1,
      },
      {
        loadSyncedDates: () => Promise.resolve(new Set()),
        fetchDay: (_credentials, date) =>
          date === "2026-11-01"
            ? Promise.reject(new Error("upstream down"))
            : Promise.resolve({ date, metrics: {} }),
        saveDay: () => Promise.resolve(),
        markSynced: () => Promise.resolve(),
      },
    );

    expect(result).toEqual({
      fetched: ["2026-11-02"],
      rateLimited: false,
      failedDate: "2026-11-01",
    });
  });
});
