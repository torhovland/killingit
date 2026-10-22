import { describe, expect, it } from "bun:test";
import type { ActivitySample } from "@killingit/shared";
import { routeFromSamples } from "./route.js";

function sample(
  latitude: number | undefined,
  longitude: number | undefined,
): ActivitySample {
  return {
    timestamp: "2026-10-01T06:30:00Z",
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
  };
}

describe("routeFromSamples", () => {
  it("keeps samples that have both coordinates", () => {
    expect(
      routeFromSamples([
        sample(59.91, 10.75),
        sample(59.92, undefined),
        sample(undefined, 10.76),
        sample(59.93, 10.77),
      ]),
    ).toEqual([
      { latitude: 59.91, longitude: 10.75 },
      { latitude: 59.93, longitude: 10.77 },
    ]);
  });

  it("downsamples long traces while keeping the first and last point", () => {
    const samples = Array.from({ length: 1000 }, (_, index) =>
      sample(59 + index / 1000, 10 + index / 1000),
    );
    const route = routeFromSamples(samples, 100);

    expect(route).toHaveLength(100);
    expect(route[0]).toEqual({ latitude: 59, longitude: 10 });
    expect(route.at(-1)).toEqual({
      latitude: 59 + 999 / 1000,
      longitude: 10 + 999 / 1000,
    });
  });

  it("returns no points for indoor activities", () => {
    expect(routeFromSamples([sample(undefined, undefined)])).toEqual([]);
  });
});
