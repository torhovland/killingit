import { describe, expect, it } from "bun:test";
import type { ActivityFeed } from "./activities.js";
import {
  latestActivityAnalysisSince,
  shareActivityAnalysis,
} from "./analysisRuns.js";

function feed(text: string): ActivityFeed {
  return { model: text, activities: [] };
}

describe("shareActivityAnalysis", () => {
  it("runs one analysis pass for overlapping requests", async () => {
    let runs = 0;
    let finish: (value: ActivityFeed) => void = () => undefined;
    const running = new Promise<ActivityFeed>((resolve) => {
      finish = resolve;
    });

    const first = shareActivityAnalysis(1, false, () => {
      runs += 1;
      return running;
    });
    const second = shareActivityAnalysis(1, false, () => {
      runs += 1;
      return Promise.resolve(feed("second"));
    });

    expect(second).toBe(first);
    const shared = feed("shared");
    finish(shared);

    expect(await first).toBe(shared);
    expect(await second).toBe(shared);
    expect(runs).toBe(1);
  });

  it("keeps different accounts independent", async () => {
    const first = await shareActivityAnalysis(1, false, () =>
      Promise.resolve(feed("one")),
    );
    const second = await shareActivityAnalysis(2, false, () =>
      Promise.resolve(feed("two")),
    );

    expect(first.model).toBe("one");
    expect(second.model).toBe("two");
  });

  it("lets an explicit refresh start while an ordinary pass is running", async () => {
    let finish: (value: ActivityFeed) => void = () => undefined;
    const running = new Promise<ActivityFeed>((resolve) => {
      finish = resolve;
    });

    const ordinary = shareActivityAnalysis(1, false, () => running);
    const refreshed = await shareActivityAnalysis(1, true, () =>
      Promise.resolve(feed("refreshed")),
    );

    expect(refreshed.model).toBe("refreshed");

    const original = feed("original");
    finish(original);
    expect(await ordinary).toBe(original);
  });

  it("clears a failed pass so the next request can retry", async () => {
    let failed: unknown = null;
    try {
      await shareActivityAnalysis(1, false, () =>
        Promise.reject(new Error("analysis failed")),
      );
    } catch (err) {
      failed = err;
    }
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toBe("analysis failed");

    const recovered = await shareActivityAnalysis(1, false, () =>
      Promise.resolve(feed("recovered")),
    );
    expect(recovered.model).toBe("recovered");
  });
});

describe("latestActivityAnalysisSince", () => {
  it("returns null when this account has not analysed anything", async () => {
    expect(await latestActivityAnalysisSince(99, 0)).toBeNull();
  });

  it("waits for a pass that is still running", async () => {
    let finish: (value: ActivityFeed) => void = () => undefined;
    const running = new Promise<ActivityFeed>((resolve) => {
      finish = resolve;
    });
    void shareActivityAnalysis(3, false, () => running);

    const waiting = latestActivityAnalysisSince(3, 0);
    const shared = feed("finished");
    finish(shared);

    expect(await waiting).toBe(shared);
  });

  it("returns the most recent pass only when it finished after the snapshot", async () => {
    const before = Date.now();
    await shareActivityAnalysis(4, false, () => Promise.resolve(feed("old")));

    expect(await latestActivityAnalysisSince(4, before)).not.toBeNull();
    expect(await latestActivityAnalysisSince(4, Date.now() + 1)).toBeNull();
  });
});
