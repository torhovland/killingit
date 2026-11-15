import { describe, expect, it } from "bun:test";
import type { AthleteLocation, DailyWeather } from "@killingit/shared";
import { makePlan } from "../testFixtures/generationHarness.js";
import {
  authenticatedRequest,
  makeTestApp as makeApp,
  MemoryGenerationStore,
  MemoryPlanStore,
} from "../testFixtures/app.js";
import {
  forecastSet,
  STALE_RUN_MS,
  waitForGeneration,
} from "../testFixtures/planRoute.js";

describe("coach plan generation", () => {
  it("generates a full plan on POST", async () => {
    const planStore = new MemoryPlanStore(null);
    const generationStore = new MemoryGenerationStore();
    const testApp = makeApp({ planStore, generationStore });

    const res = await testApp.fetch(
      authenticatedRequest("/api/coaching/plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21" }),
      }),
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      plan: { today: { date: string } } | null;
      generation: { status: string };
    };
    // The request returns before the background generation finishes.
    expect(body.generation.status).toBe("running");

    await waitForGeneration(generationStore);
    expect(generationStore.status.status).toBe("done");
    expect(planStore.stored?.plan.today.date).toBe("2026-10-21");
  });

  it("starts a new season even when the stored plan is current", async () => {
    const stored = makePlan();
    stored.season = { ...stored.season, goal: "Old goal" };
    const planStore = new MemoryPlanStore({
      plan: stored,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });
    const generationStore = new MemoryGenerationStore();
    const testApp = makeApp({ planStore, generationStore });

    const res = await testApp.fetch(
      authenticatedRequest("/api/coaching/plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          mode: "newSeason",
        }),
      }),
    );

    expect(res.status).toBe(202);
    await waitForGeneration(generationStore);
    expect(generationStore.status.status).toBe("done");
    expect(planStore.stored?.plan.season.goal).toBe("Run a marathon.");
  });

  it("loads the forecast for the saved location and attaches it", async () => {
    const planStore = new MemoryPlanStore(null);
    const generationStore = new MemoryGenerationStore();
    const location: AthleteLocation = {
      latitude: 59.91,
      longitude: 10.75,
      name: "Oslo",
    };
    const seen: AthleteLocation[] = [];
    const testApp = makeApp({
      planStore,
      generationStore,
      location,
      loadForecast: (entry) => {
        seen.push(entry);
        const openMeteo: DailyWeather[] = [
          {
            date: "2026-10-21",
            icon: "rain",
            temperatureMaxC: 9,
            temperatureMinC: 5,
            windMaxMs: 4,
            gustMaxMs: 8,
            precipitationMm: 2,
          },
        ];
        const yr: DailyWeather[] = [
          {
            date: "2026-10-21",
            icon: "rain",
            temperatureMaxC: 11,
            temperatureMinC: 7,
            windMaxMs: 6,
            gustMaxMs: 10,
            precipitationMm: 4,
          },
        ];
        return Promise.resolve(forecastSet(openMeteo, yr));
      },
    });

    const res = await testApp.fetch(
      authenticatedRequest("/api/coaching/plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21" }),
      }),
    );
    expect(res.status).toBe(202);
    await waitForGeneration(generationStore);

    expect(seen).toEqual([location]);
    expect(planStore.stored?.plan.today.weather?.icon).toBe("rain");
    expect(planStore.stored?.plan.today.weather?.temperatureMaxC).toBe(10);
    expect(
      planStore.stored?.plan.today.forecasts?.openMeteo?.temperatureMaxC,
    ).toBe(9);
    expect(planStore.stored?.plan.today.forecasts?.yr?.temperatureMaxC).toBe(
      11,
    );
    expect(
      planStore.stored?.plan.today.forecasts?.combined?.temperatureMaxC,
    ).toBe(10);
  });

  it("continues when the forecast service fails", async () => {
    const planStore = new MemoryPlanStore(null);
    const generationStore = new MemoryGenerationStore();
    const testApp = makeApp({
      planStore,
      generationStore,
      location: { latitude: 59.91, longitude: 10.75, name: "Oslo" },
      loadForecast: () => Promise.reject(new Error("weather down")),
    });

    const res = await testApp.fetch(
      authenticatedRequest("/api/coaching/plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21" }),
      }),
    );
    expect(res.status).toBe(202);
    await waitForGeneration(generationStore);
    expect(generationStore.status.status).toBe("done");
    expect(planStore.stored?.plan.today.weather).toBeUndefined();
  });

  it("releases a stale running generation so the athlete can retry", async () => {
    const generationStore = new MemoryGenerationStore();
    generationStore.running = true;
    generationStore.status = {
      ...generationStore.status,
      status: "running",
      runId: "stale-run",
      step: "Choosing tomorrow's session",
      progress: 90,
      updatedAt: new Date(Date.now() - STALE_RUN_MS - 1000).toISOString(),
    };
    const marked: { userId: number; error: string }[] = [];

    const res = await makeApp({
      generationStore,
      markPlanPromptsFailed: (userId, _since, error) => {
        marked.push({ userId, error });
        return Promise.resolve();
      },
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generation: { status: string; error: string | null };
    };
    expect(body.generation.status).toBe("error");
    expect(body.generation.error).toContain("stopped before finishing");
    expect(generationStore.running).toBe(false);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.userId).toBe(42);
    expect(marked[0]?.error).toContain("stopped before finishing");
  });

  it("keeps a run that was replaced after the stale status was read", async () => {
    class HeartbeatOnFailStore extends MemoryGenerationStore {
      override fail(
        userId: number,
        error: string,
        runId: string,
      ): Promise<Date | null> {
        // A newer run claims the row between the GET's read and its release.
        this.status = { ...this.status, runId: "newer-run" };
        return super.fail(userId, error, runId);
      }
    }

    const generationStore = new HeartbeatOnFailStore();
    generationStore.running = true;
    generationStore.status = {
      ...generationStore.status,
      status: "running",
      runId: "stale-run",
      step: "Choosing tomorrow's session",
      progress: 90,
      updatedAt: new Date(Date.now() - STALE_RUN_MS - 1000).toISOString(),
    };
    const marked: string[] = [];

    const res = await makeApp({
      generationStore,
      markPlanPromptsFailed: (_userId, _since, error) => {
        marked.push(error);
        return Promise.resolve();
      },
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generation: { status: string; error: string | null };
    };
    expect(body.generation.status).toBe("running");
    expect(body.generation.error).toBeNull();
    expect(generationStore.running).toBe(true);
    expect(marked).toEqual([]);
  });

  it("keeps a fresh running generation live", async () => {
    const generationStore = new MemoryGenerationStore();
    generationStore.running = true;
    generationStore.status = {
      ...generationStore.status,
      status: "running",
      step: "Choosing tomorrow's session",
      progress: 90,
      updatedAt: new Date().toISOString(),
    };

    const res = await makeApp({ generationStore }).fetch(
      authenticatedRequest("/api/coaching/plan?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { generation: { status: string } };
    expect(body.generation.status).toBe("running");
    expect(generationStore.running).toBe(true);
  });

  it("returns 202 when a generation is already running", async () => {
    const generationStore = new MemoryGenerationStore();
    generationStore.running = true;
    const testApp = makeApp({ generationStore });

    const res = await testApp.fetch(
      authenticatedRequest("/api/coaching/plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21" }),
      }),
    );

    expect(res.status).toBe(202);
  });

  it("rejects an invalid generate body", async () => {
    const res = await makeApp({}).fetch(
      authenticatedRequest("/api/coaching/plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "nope" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
