import { describe, expect, it } from "bun:test";
import type { GarminMetricsResponse } from "@killingit/shared";
import { syncGarminSupplements } from "./supplements.js";

const credentials = { username: "athlete", password: "secret" };
const today = "2026-11-14";

const snapshot: GarminMetricsResponse = {
  metrics: [{ date: "2026-11-13", weightKg: 72.4 }],
  ftp: [{ date: "2026-11-01", watts: 280 }],
};

describe("syncGarminSupplements", () => {
  it("stores the metrics and FTP before syncing daily health", async () => {
    const calls: string[] = [];

    await syncGarminSupplements(7, credentials, today, {
      syncMetrics: () => {
        calls.push("syncMetrics");
        return Promise.resolve(snapshot);
      },
      saveMetrics: () => {
        calls.push("saveMetrics");
        return Promise.resolve();
      },
      saveFtp: () => {
        calls.push("saveFtp");
        return Promise.resolve();
      },
      syncDaily: (options) => {
        calls.push(`syncDaily:${options.userId}:${options.today}`);
        return Promise.resolve({
          fetched: [],
          rateLimited: false,
          failedDate: null,
        });
      },
    });

    expect(calls).toEqual([
      "syncMetrics",
      "saveMetrics",
      "saveFtp",
      `syncDaily:7:${today}`,
    ]);
  });

  it("still syncs daily health when the metrics sync fails", async () => {
    const daily = { userId: null as number | null };

    await syncGarminSupplements(7, credentials, today, {
      syncMetrics: () => Promise.reject(new Error("body composition outage")),
      saveMetrics: () => Promise.reject(new Error("must not be called")),
      saveFtp: () => Promise.reject(new Error("must not be called")),
      syncDaily: (options) => {
        daily.userId = options.userId;
        return Promise.resolve({
          fetched: [],
          rateLimited: false,
          failedDate: null,
        });
      },
    });

    expect(daily.userId).toBe(7);
  });

  it("does not throw when storing the metrics fails", async () => {
    const daily = { userId: null as number | null };

    await syncGarminSupplements(7, credentials, today, {
      syncMetrics: () => Promise.resolve(snapshot),
      saveMetrics: () => Promise.reject(new Error("database outage")),
      saveFtp: () => Promise.resolve(),
      syncDaily: (options) => {
        daily.userId = options.userId;
        return Promise.resolve({
          fetched: [],
          rateLimited: false,
          failedDate: null,
        });
      },
    });

    expect(daily.userId).toBe(7);
  });

  it("does not throw when the daily health sync fails", () =>
    expect(
      syncGarminSupplements(7, credentials, today, {
        syncMetrics: () => Promise.resolve(snapshot),
        saveMetrics: () => Promise.resolve(),
        saveFtp: () => Promise.resolve(),
        syncDaily: () => Promise.reject(new Error("daily outage")),
      }),
    ).resolves.toBeUndefined());
});
