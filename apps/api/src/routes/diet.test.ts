import { describe, expect, it } from "bun:test";
import type { FoodAnalysis } from "@killingit/shared";
import { createApp } from "../index.js";
import type { FoodAnalysisInput } from "../llm/foodPrompt.js";
import type { createMealThumbnail } from "../diet/thumbnail.js";
import type { LlmClient } from "../llm/client.js";
import type { PlanContextInput } from "../llm/planContext.js";
import type { LlmProvider } from "../llm/openrouter.js";
import type { PlanStore, StoredPlan } from "../plans/store.js";
import type { loadPlanDayCalories } from "../plans/dayCalories.js";
import type {
  FoodEntryStore,
  NewFoodEntry,
  StoredFoodEntry,
} from "../diet/store.js";
import type { UserStore } from "../users/store.js";

const analysis: FoodAnalysis = {
  meal: "A cheese sandwich and an apple",
  carbsGrams: 55,
  proteinGrams: 18,
  fatGrams: 12,
  caloriesKcal: 420,
  dietFit: "Fine before an easy afternoon run.",
};

class MemoryFoodStore implements FoodEntryStore {
  readonly rows: { userId: number; entry: StoredFoodEntry }[] = [];
  private nextId = 1;

  create(userId: number, entry: NewFoodEntry): Promise<StoredFoodEntry> {
    const stored: StoredFoodEntry = {
      id: this.nextId,
      ...entry,
      createdAt: new Date("2026-11-07T12:00:00Z"),
    };
    this.nextId += 1;
    this.rows.push({ userId, entry: stored });
    return Promise.resolve(stored);
  }

  listForUser(userId: number): Promise<StoredFoodEntry[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.userId === userId)
        .map((row) => row.entry)
        .sort((a, b) => b.eatenAt.getTime() - a.eatenAt.getTime()),
    );
  }

  listSince(userId: number, sinceDate: string): Promise<StoredFoodEntry[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) => row.userId === userId && row.entry.eatenDate >= sinceDate,
        )
        .map((row) => row.entry),
    );
  }

  photo(userId: number, id: number): Promise<string | null> {
    return Promise.resolve(
      this.rows.find((row) => row.userId === userId && row.entry.id === id)
        ?.entry.thumbnailDataUrl ?? null,
    );
  }
}

function userStore(withDietAdvice: boolean): UserStore {
  const user = (sub: string) => ({
    id: 42,
    sub,
    role: "member" as const,
    timezone: null,
    location: null,
    dietAdvice: withDietAdvice,
    createdAt: new Date(0),
  });
  return {
    ensureUser: (sub) => Promise.resolve(user(sub)),
    getById: (id) => Promise.resolve({ ...user("athlete-1"), id }),
    deleteUser: () => Promise.resolve(),
    updateSettings: (sub) => Promise.resolve(user(sub)),
  };
}

const provider: LlmProvider = {
  id: "fake",
  listModels: () => Promise.resolve([]),
  validateKey: () => Promise.resolve(),
  complete: () => Promise.resolve("{}"),
};

const context: PlanContextInput = {
  athleteAnswers: [],
  recentActivities: [],
  today: "2026-11-07",
};

function makeApp(
  options: {
    dietAdvice?: boolean;
    store?: MemoryFoodStore;
    llm?: LlmClient | null;
    analyze?: NonNullable<Parameters<typeof createApp>[0]>["analyzeFood"];
    createThumbnail?: typeof createMealThumbnail;
    planStore?: PlanStore;
    loadDayCalories?: typeof loadPlanDayCalories;
  } = {},
) {
  const store = options.store ?? new MemoryFoodStore();
  const llm =
    options.llm === undefined
      ? { provider, apiKey: "key", model: "test/model" }
      : options.llm;
  const analyzeFood =
    options.analyze ??
    (() => Promise.resolve({ analysis, model: "test/model" }));
  const app = createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "athlete-1" }) },
    userStore: userStore(options.dietAdvice ?? true),
    answerStore: {
      listForUser: () => Promise.resolve([]),
      saveAnswers: () => Promise.resolve(true),
    },
    dietEntries: store,
    ...(options.planStore !== undefined
      ? { planStore: options.planStore }
      : {}),
    ...(options.loadDayCalories !== undefined
      ? { loadDayCalories: options.loadDayCalories }
      : {}),
    loadLlm: () => Promise.resolve(llm),
    loadFoodContext: () => Promise.resolve(context),
    analyzeFood,
    createMealThumbnail:
      options.createThumbnail ?? (() => Promise.resolve(generatedThumbnail)),
  });
  return { app, store };
}

function request(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://localhost${path}`, {
        ...init,
        headers: {
          authorization: "Bearer test",
          ...(init?.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...init?.headers,
        },
      }),
    ),
  );
}

const body = {
  eatenAt: "2026-11-07T22:30:00.000Z",
  timezone: "Europe/Oslo",
  today: "2026-11-08",
  description: "A cheese sandwich",
};

// Different bytes so a test can prove which image was stored and served.
const fullPhoto = "data:image/jpeg;base64,QUJD";
// What the injected thumbnail generator returns. Its bytes are [1, 2, 3].
const generatedThumbnail = "data:image/jpeg;base64,AQID";

describe("POST /api/diet/entries", () => {
  it("refuses to log a meal when diet advice is off", async () => {
    const { app } = makeApp({ dietAdvice: false });
    const res = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(409);
  });

  it("stores the meal with the coach analysis and local date", async () => {
    const { app, store } = makeApp();
    const res = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(201);
    const entry = (await res.json()) as {
      id: number;
      description: string;
      analysis: FoodAnalysis;
    };
    expect(entry.description).toBe("A cheese sandwich");
    expect(entry.analysis.carbsGrams).toBe(55);
    // 22:30 UTC is 23:30 in Oslo, on the same local date.
    expect(store.rows[0]?.entry).toMatchObject({
      eatenDate: "2026-11-07",
      eatenTime: "23:30",
    });
  });

  it("logs a photo alone and sends the full image to the coach", async () => {
    const seen: FoodAnalysisInput[] = [];
    const { app, store } = makeApp({
      analyze: (_provider, _credentials, input) => {
        seen.push(input);
        return Promise.resolve({ analysis, model: "test/model" });
      },
    });

    const res = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify({
        eatenAt: body.eatenAt,
        timezone: body.timezone,
        today: body.today,
        photoDataUrl: fullPhoto,
      }),
    });

    expect(res.status).toBe(201);
    const entry = (await res.json()) as {
      description: string | null;
      hasPhoto: boolean;
    };
    expect(entry.description).toBeNull();
    expect(entry.hasPhoto).toBe(true);
    expect(seen[0]?.description).toBeNull();
    // The coach sees the full photo; the API stores its own thumbnail.
    expect(seen[0]?.photoDataUrl).toBe(fullPhoto);
    expect(store.rows[0]?.entry.thumbnailDataUrl).toBe(generatedThumbnail);
  });

  it("keeps the meal out of the log when the photo cannot be read", async () => {
    const { app, store } = makeApp({
      createThumbnail: () => Promise.reject(new Error("unsupported image")),
    });
    const res = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify({
        eatenAt: body.eatenAt,
        timezone: body.timezone,
        description: "A cheese sandwich",
        photoDataUrl: fullPhoto,
      }),
    });

    expect(res.status).toBe(400);
    expect(store.rows).toHaveLength(0);
  });

  it("rejects a meal with neither a description nor a photo", async () => {
    const { app } = makeApp();
    const res = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify({
        eatenAt: body.eatenAt,
        timezone: body.timezone,
      }),
    });

    expect(res.status).toBe(400);
  });

  it("keeps the meal when the coach cannot analyse it", async () => {
    const { app, store } = makeApp({
      analyze: () => Promise.reject(new Error("model unavailable")),
    });
    const res = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(201);
    const entry = (await res.json()) as {
      analysis: unknown;
      analysisError: string | null;
    };
    expect(entry.analysis).toBeNull();
    expect(entry.analysisError).toBe("model unavailable");
    expect(store.rows).toHaveLength(1);
  });

  it("stores an explanation when no model is configured", async () => {
    const { app } = makeApp({ llm: null });
    const res = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(201);
    const entry = (await res.json()) as { analysisError: string | null };
    expect(entry.analysisError).toContain("OpenRouter");
  });
});

describe("GET /api/diet/entries", () => {
  it("lists every meal without photo bytes", async () => {
    const { app } = makeApp();
    await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify({
        ...body,
        photoDataUrl: fullPhoto,
      }),
    });

    const res = await request(app, "/api/diet/entries");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as {
      entries: { hasPhoto: boolean; id: number }[];
    };
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.hasPhoto).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("base64");
  });
});

describe("GET /api/diet/summary", () => {
  function planStoreWith(
    diet: {
      goal: string;
      assessment: string;
    } | null,
  ): PlanStore {
    return {
      load: () =>
        Promise.resolve({
          plan: { diet },
        } as unknown as StoredPlan),
      save: () => Promise.resolve(null),
    };
  }

  it("returns the coach's goal, assessment, and per-day calories", async () => {
    const store = new MemoryFoodStore();
    store.rows.push({
      userId: 42,
      entry: {
        id: 1,
        eatenAt: new Date("2026-11-07T12:00:00Z"),
        eatenDate: "2026-11-07",
        eatenTime: "12:00",
        description: "A cheese sandwich",
        thumbnailDataUrl: null,
        analysis,
        model: "test/model",
        analysisError: null,
        createdAt: new Date("2026-11-07T12:00:00Z"),
      },
    });
    const app = makeApp({
      store,
      planStore: planStoreWith({
        goal: "Lose 3 kg by March",
        assessment: "The trend is on target for the goal.",
      }),
      loadDayCalories: () => Promise.resolve(new Map([["2026-11-07", 2400]])),
    }).app;

    const res = await request(app, "/api/diet/summary?today=2026-11-07");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as {
      goal: string;
      assessment: string;
      days: {
        date: string;
        neededCaloriesKcal: number;
        consumedCaloriesKcal: number;
        balanceKcal: number;
        entries: unknown[];
      }[];
    };
    expect(parsed.goal).toBe("Lose 3 kg by March");
    expect(parsed.assessment).toContain("on target");
    expect(parsed.days[0]).toMatchObject({
      date: "2026-11-07",
      neededCaloriesKcal: 2400,
      consumedCaloriesKcal: 420,
      balanceKcal: -1980,
    });
    expect(parsed.days[0]?.entries).toHaveLength(1);
  });

  it("returns an empty summary when diet advice is off", async () => {
    const app = makeApp({ dietAdvice: false }).app;
    const res = await request(app, "/api/diet/summary?today=2026-11-07");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as {
      goal: null;
      days: unknown[];
    };
    expect(parsed.goal).toBeNull();
    expect(parsed.days).toHaveLength(0);
  });
});

describe("GET /api/diet/entries/:id/photo", () => {
  it("serves the API-generated thumbnail to its owner", async () => {
    const { app } = makeApp();
    const created = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify({
        ...body,
        photoDataUrl: fullPhoto,
      }),
    });
    const entry = (await created.json()) as { id: number };

    const res = await request(app, `/api/diet/entries/${entry.id}/photo`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    // The thumbnail's bytes, not the full photo's "ABC".
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("returns 404 for a meal without a photo", async () => {
    const { app } = makeApp();
    const created = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const entry = (await created.json()) as { id: number };

    const res = await request(app, `/api/diet/entries/${entry.id}/photo`);
    expect(res.status).toBe(404);
  });
});
