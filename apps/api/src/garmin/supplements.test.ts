import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  startGarminSupplements,
  syncGarminSupplements,
} from "./supplements.js";

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

describe("startGarminSupplements", () => {
  it("returns at once without waiting for the pass", async () => {
    let finish: () => void = () => {};
    const pass = mock(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const running = startGarminSupplements(29901, pass);
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(pass).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    finish();
    await running;
  });

  it("runs one pass per account at a time", async () => {
    let finish: () => void = () => {};
    const first = mock(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const second = mock(() => Promise.resolve());

    const running = startGarminSupplements(29902, first);
    const joined = startGarminSupplements(29902, second);

    expect(joined).toBe(running);
    expect(second).not.toHaveBeenCalled();

    finish();
    await running;
  });

  it("starts a new pass once the previous one has settled", async () => {
    const pass = mock(() => Promise.resolve());

    await startGarminSupplements(29903, pass);
    await startGarminSupplements(29903, pass);

    expect(pass).toHaveBeenCalledTimes(2);
  });

  it("logs a failing pass instead of rejecting", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const running = startGarminSupplements(29904, () =>
        Promise.reject(new Error("sidecar down")),
      );

      await running;

      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[0])).toContain(
        "supplementary sync failed",
      );
      expect(String(log.mock.calls[0]?.[1])).toContain("sidecar down");
    } finally {
      log.mockRestore();
    }
  });
});
