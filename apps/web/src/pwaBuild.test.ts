import { describe, expect, it } from "bun:test";
import { isSameBuild, readPageBuildId, requestWorkerBuildId } from "./pwaBuild";

function fakeDocument(content: string | null) {
  return {
    querySelector: () =>
      content === null ? null : { getAttribute: () => content },
  };
}

describe("readPageBuildId", () => {
  it("reads the build the shell was stamped with", () => {
    expect(readPageBuildId(fakeDocument("a1b2c3d4e5f60718"))).toBe(
      "a1b2c3d4e5f60718",
    );
  });

  it("reports no build for a development page or a missing tag", () => {
    expect(readPageBuildId(fakeDocument("__APP_BUILD__"))).toBeNull();
    expect(readPageBuildId(fakeDocument("  "))).toBeNull();
    expect(readPageBuildId(fakeDocument(null))).toBeNull();
  });
});

describe("requestWorkerBuildId", () => {
  it("returns the build a worker reports", async () => {
    const worker = {
      postMessage: (_message: unknown, transfer?: Transferable[]) => {
        const port = transfer?.[0] as MessagePort | undefined;
        port?.postMessage({ type: "BUILD_ID", buildId: "abc123" });
      },
    };

    expect(await requestWorkerBuildId(worker)).toBe("abc123");
  });

  it("reports no build when the worker stays silent", async () => {
    const worker = { postMessage: () => {} };

    expect(await requestWorkerBuildId(worker, 10)).toBeNull();
  });

  it("reports no build when the message cannot be sent", async () => {
    const worker = {
      postMessage: () => {
        throw new Error("worker is gone");
      },
    };

    expect(await requestWorkerBuildId(worker, 10)).toBeNull();
  });
});

describe("isSameBuild", () => {
  it("matches only two known equal builds", () => {
    expect(isSameBuild("abc", "abc")).toBe(true);
    expect(isSameBuild("abc", "def")).toBe(false);
    expect(isSameBuild("abc", null)).toBe(false);
    expect(isSameBuild(null, null)).toBe(false);
  });
});
