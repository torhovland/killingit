import { describe, expect, it } from "bun:test";
import type { ActivityFeed } from "./activities.js";
import {
  latestActivityAnalysisSince,
  MAX_COMPLETED_ANALYSES,
  shareActivityAnalysis,
} from "./analysisRuns.js";

function feed(text: string): ActivityFeed {
  return { model: text, activities: [] };
}

const TODAY = "2026-11-13";
const TOMORROW = "2026-11-14";

function deferred(): {
  promise: Promise<ActivityFeed>;
  finish: (value: ActivityFeed) => void;
  fail: (error: Error) => void;
} {
  let finish: (value: ActivityFeed) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const promise = new Promise<ActivityFeed>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  return { promise, finish, fail };
}

describe("shareActivityAnalysis", () => {
  it("runs one analysis pass for overlapping requests on the same day", async () => {
    let runs = 0;
    const running = deferred();

    const first = shareActivityAnalysis(1, TODAY, false, () => {
      runs += 1;
      return running.promise;
    });
    const second = shareActivityAnalysis(1, TODAY, false, () => {
      runs += 1;
      return Promise.resolve(feed("second"));
    });

    expect(second).toBe(first);
    const shared = feed("shared");
    running.finish(shared);

    expect(await first).toBe(shared);
    expect(await second).toBe(shared);
    expect(runs).toBe(1);
  });

  it("keeps different accounts independent", async () => {
    const first = await shareActivityAnalysis(2, TODAY, false, () =>
      Promise.resolve(feed("one")),
    );
    const second = await shareActivityAnalysis(3, TODAY, false, () =>
      Promise.resolve(feed("two")),
    );

    expect(first.model).toBe("one");
    expect(second.model).toBe("two");
  });

  it("waits for the running pass before an explicit refresh starts", async () => {
    const order: string[] = [];
    const running = deferred();

    const ordinary = shareActivityAnalysis(4, TODAY, false, () => {
      order.push("ordinary");
      return running.promise;
    });
    const refreshed = shareActivityAnalysis(4, TODAY, true, () => {
      order.push("refresh");
      return Promise.resolve(feed("refreshed"));
    });

    await Promise.resolve();
    expect(order).toEqual(["ordinary"]);

    const original = feed("original");
    running.finish(original);

    expect(await ordinary).toBe(original);
    expect((await refreshed).model).toBe("refreshed");
    expect(order).toEqual(["ordinary", "refresh"]);
  });

  it("does not share a pass computed for another day", async () => {
    const order: string[] = [];
    const running = deferred();

    const today = shareActivityAnalysis(5, TODAY, false, () => {
      order.push("today");
      return running.promise;
    });
    const tomorrow = shareActivityAnalysis(5, TOMORROW, false, () => {
      order.push("tomorrow");
      return Promise.resolve(feed("tomorrow"));
    });

    await Promise.resolve();
    expect(tomorrow).not.toBe(today);
    expect(order).toEqual(["today"]);

    running.finish(feed("today"));

    expect((await today).model).toBe("today");
    expect((await tomorrow).model).toBe("tomorrow");
    expect(order).toEqual(["today", "tomorrow"]);
  });

  it("clears a failed pass so the next request can retry", async () => {
    let failed: unknown = null;
    try {
      await shareActivityAnalysis(6, TODAY, false, () =>
        Promise.reject(new Error("analysis failed")),
      );
    } catch (err) {
      failed = err;
    }
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toBe("analysis failed");

    const recovered = await shareActivityAnalysis(6, TODAY, false, () =>
      Promise.resolve(feed("recovered")),
    );
    expect(recovered.model).toBe("recovered");
  });

  it("does not fail a chained refresh when the pass it follows fails", async () => {
    const running = deferred();

    const ordinary = shareActivityAnalysis(
      7,
      TODAY,
      false,
      () => running.promise,
    );
    const refreshed = shareActivityAnalysis(7, TODAY, true, () =>
      Promise.resolve(feed("recovered")),
    );

    running.fail(new Error("analysis failed"));

    let failed: unknown = null;
    try {
      await ordinary;
    } catch (err) {
      failed = err;
    }
    expect((failed as Error).message).toBe("analysis failed");
    expect((await refreshed).model).toBe("recovered");
  });
});

describe("latestActivityAnalysisSince", () => {
  it("returns null when this account has not analysed anything", async () => {
    expect(await latestActivityAnalysisSince(99, TODAY, 0)).toBeNull();
  });

  it("waits for a pass for the same day that is still running", async () => {
    const running = deferred();
    void shareActivityAnalysis(10, TODAY, false, () => running.promise);

    let settled = false;
    const waiting = latestActivityAnalysisSince(10, TODAY, 0).then((value) => {
      settled = true;
      return value;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    const shared = feed("finished");
    running.finish(shared);

    expect(await waiting).toBe(shared);
  });

  it("does not wait for a pass computed for another day", async () => {
    const running = deferred();
    void shareActivityAnalysis(11, TODAY, false, () => running.promise);

    let settled = false;
    const waiting = latestActivityAnalysisSince(11, TOMORROW, 0).then(
      (value) => {
        settled = true;
        return value;
      },
    );

    await Promise.resolve();
    expect(settled).toBe(true);
    expect(await waiting).toBeNull();

    running.finish(feed("today"));
  });

  it("returns the most recent pass only when it finished after the snapshot", async () => {
    const before = Date.now();
    await shareActivityAnalysis(12, TODAY, false, () =>
      Promise.resolve(feed("old")),
    );

    expect(await latestActivityAnalysisSince(12, TODAY, before)).not.toBeNull();
    expect(
      await latestActivityAnalysisSince(12, TODAY, Date.now() + 1),
    ).toBeNull();
  });

  it("returns a finished feed only for the day it was computed for", async () => {
    await shareActivityAnalysis(13, TODAY, false, () =>
      Promise.resolve(feed("today")),
    );

    expect((await latestActivityAnalysisSince(13, TODAY, 0))?.model).toBe(
      "today",
    );
    expect(await latestActivityAnalysisSince(13, TOMORROW, 0)).toBeNull();
  });

  it("keeps a used feed while the oldest other accounts are evicted", async () => {
    const keptUser = 500;
    const otherUsers = Array.from(
      { length: MAX_COMPLETED_ANALYSES - 1 },
      (_, index) => 501 + index,
    );
    const oldestOther = otherUsers[0];
    const newestOther = otherUsers[otherUsers.length - 1];
    if (oldestOther === undefined || newestOther === undefined) {
      throw new Error("expected at least one other account");
    }

    await shareActivityAnalysis(keptUser, TODAY, false, () =>
      Promise.resolve(feed("kept")),
    );
    for (const userId of otherUsers) {
      await shareActivityAnalysis(userId, TODAY, false, () =>
        Promise.resolve(feed(`other-${userId}`)),
      );
    }

    // Reading the kept feed makes its account the most recently used, so the
    // entry that is evicted when another account finishes is an untouched one.
    expect((await latestActivityAnalysisSince(keptUser, TODAY, 0))?.model).toBe(
      "kept",
    );
    await shareActivityAnalysis(900, TODAY, false, () =>
      Promise.resolve(feed("new")),
    );

    expect((await latestActivityAnalysisSince(keptUser, TODAY, 0))?.model).toBe(
      "kept",
    );
    expect(
      (await latestActivityAnalysisSince(newestOther, TODAY, 0))?.model,
    ).toBe(`other-${newestOther}`);
    expect(await latestActivityAnalysisSince(oldestOther, TODAY, 0)).toBeNull();
    expect((await latestActivityAnalysisSince(900, TODAY, 0))?.model).toBe(
      "new",
    );
  });
});
