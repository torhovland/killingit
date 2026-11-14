import { describe, expect, it, mock } from "bun:test";
import { syncGarminSupplements } from "./supplements.js";

const credentials = { username: "rider", password: "secret" };

describe("syncGarminSupplements", () => {
  it("stores the weigh-ins and FTP, then backfills daily health for today", async () => {
    const saveMetrics = mock(() => Promise.resolve());
    const saveFtp = mock(() => Promise.resolve());
    const syncDaily = mock(() =>
      Promise.resolve({ fetched: [], rateLimited: false, failedDate: null }),
    );

    await syncGarminSupplements(7, credentials, "2026-11-14", {
      syncMetrics: () =>
        Promise.resolve({
          metrics: [{ date: "2026-11-13", weightKg: 71 }],
          ftp: [{ date: "2026-11-01", watts: 280 }],
        }),
      saveMetrics,
      saveFtp,
      syncDaily,
    });

    expect(saveMetrics).toHaveBeenCalledWith(7, [
      { date: "2026-11-13", weightKg: 71 },
    ]);
    expect(saveFtp).toHaveBeenCalledWith(7, [
      { date: "2026-11-01", watts: 280 },
    ]);
    expect(syncDaily).toHaveBeenCalledWith({
      userId: 7,
      credentials,
      today: "2026-11-14",
    });
  });

  it("still backfills daily health when the metrics sync fails", async () => {
    const saveMetrics = mock(() => Promise.resolve());
    const syncDaily = mock(() =>
      Promise.resolve({ fetched: [], rateLimited: false, failedDate: null }),
    );

    await syncGarminSupplements(7, credentials, "2026-11-14", {
      syncMetrics: () => Promise.reject(new Error("metrics timeout")),
      saveMetrics,
      syncDaily,
    });

    expect(saveMetrics).not.toHaveBeenCalled();
    expect(syncDaily).toHaveBeenCalled();
  });

  it("does not fail when the daily health backfill fails", async () => {
    const syncDaily = mock(() => Promise.reject(new Error("sidecar down")));

    await syncGarminSupplements(7, credentials, "2026-11-14", {
      syncMetrics: () => Promise.resolve({ metrics: [], ftp: [] }),
      saveMetrics: () => Promise.resolve(),
      saveFtp: () => Promise.resolve(),
      syncDaily,
    });

    expect(syncDaily).toHaveBeenCalled();
  });

  it("does not fail when a body-metric write fails", async () => {
    const saveFtp = mock(() => Promise.resolve());
    const syncDaily = mock(() =>
      Promise.resolve({ fetched: [], rateLimited: false, failedDate: null }),
    );

    await syncGarminSupplements(7, credentials, "2026-11-14", {
      syncMetrics: () =>
        Promise.resolve({ metrics: [{ date: "2026-11-13" }], ftp: [] }),
      saveMetrics: () => Promise.reject(new Error("write failed")),
      saveFtp,
      syncDaily,
    });

    expect(saveFtp).not.toHaveBeenCalled();
    expect(syncDaily).toHaveBeenCalled();
  });
});
