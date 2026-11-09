import { describe, expect, it } from "bun:test";
import type { FoodAnalysis } from "@killingit/shared";
import { createApp } from "../index.js";
import type { FoodAnalysisInput } from "../llm/foodPrompt.js";
import type { createMealPhotos } from "../diet/thumbnail.js";
import type { LlmClient } from "../llm/client.js";
import type { PlanContextInput } from "../llm/planContext.js";
import type { LlmProvider } from "../llm/openrouter.js";
import type { PlanStore, StoredPlan } from "../plans/store.js";
import type { loadPlanDayCalorieTargets } from "../plans/dayCalories.js";
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
      updatedAt: new Date("2026-11-07T12:00:00Z"),
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

  findForUser(userId: number, id: number): Promise<StoredFoodEntry | null> {
    return Promise.resolve(
      this.rows.find((row) => row.userId === userId && row.entry.id === id)
        ?.entry ?? null,
    );
  }

  update(
    userId: number,
    id: number,
    entry: NewFoodEntry,
  ): Promise<StoredFoodEntry | null> {
    const row = this.rows.find(
      (candidate) => candidate.userId === userId && candidate.entry.id === id,
    );
    if (row === undefined) {
      return Promise.resolve(null);
    }
    row.entry = {
      id,
      ...entry,
      createdAt: row.entry.createdAt,
      updatedAt: new Date("2026-11-07T13:00:00Z"),
    };
    return Promise.resolve(row.entry);
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
    createPhotos?: typeof createMealPhotos;
    planStore?: PlanStore;
    loadDayCalorieTargets?: typeof loadPlanDayCalorieTargets;
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
    ...(options.loadDayCalorieTargets !== undefined
      ? { loadDayCalorieTargets: options.loadDayCalorieTargets }
      : {}),
    loadLlm: () => Promise.resolve(llm),
    loadFoodContext: () => Promise.resolve(context),
    analyzeFood,
    createMealPhotos:
      options.createPhotos ??
      (() =>
        Promise.resolve({
          analysisDataUrl: generatedAnalysisPhoto,
          thumbnailDataUrl: generatedThumbnail,
        })),
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
// What the injected photo generator returns for the coach and the thumbnail.
// Their bytes are [4, 5, 6] and [1, 2, 3].
const generatedAnalysisPhoto = "data:image/jpeg;base64,BAUG";
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
    // The coach sees the bounded analysis copy; the API stores its own thumbnail.
    expect(seen[0]?.photoDataUrl).toBe(generatedAnalysisPhoto);
    expect(store.rows[0]?.entry.thumbnailDataUrl).toBe(generatedThumbnail);
  });

  it("keeps the meal out of the log when the photo cannot be read", async () => {
    const { app, store } = makeApp({
      createPhotos: () => Promise.reject(new Error("unsupported image")),
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

describe("PATCH /api/diet/entries/:id", () => {
  async function createMeal(
    app: ReturnType<typeof createApp>,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: number }> {
    const created = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify({ ...body, ...extra }),
    });
    return (await created.json()) as { id: number };
  }

  it("edits the meal and re-assesses it with the new description", async () => {
    const seen: FoodAnalysisInput[] = [];
    const { app, store } = makeApp({
      analyze: (_provider, _credentials, input) => {
        seen.push(input);
        return Promise.resolve({ analysis, model: "test/model" });
      },
    });
    const created = await createMeal(app);

    const res = await request(app, `/api/diet/entries/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "A cheese sandwich and an apple" }),
    });

    expect(res.status).toBe(200);
    const updated = (await res.json()) as {
      description: string;
      analysis: FoodAnalysis;
      updatedAt: string;
    };
    expect(updated.description).toBe("A cheese sandwich and an apple");
    expect(updated.analysis.carbsGrams).toBe(55);
    expect(seen).toHaveLength(2);
    expect(seen[1]?.description).toBe("A cheese sandwich and an apple");
    // The coach sees the meal it assessed before, so it can adjust that
    // assessment instead of starting from scratch.
    expect(seen[1]?.previous).toEqual({
      description: "A cheese sandwich",
      analysis,
    });
    expect(store.rows[0]?.entry.description).toBe(
      "A cheese sandwich and an apple",
    );
  });

  it("re-assesses an unchanged meal when the body is empty", async () => {
    let calls = 0;
    const { app } = makeApp({
      analyze: () => {
        calls += 1;
        return Promise.resolve({ analysis, model: "test/model" });
      },
    });
    const created = await createMeal(app);

    const res = await request(app, `/api/diet/entries/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("moves a meal to a different local day and time", async () => {
    const { app, store } = makeApp();
    const created = await createMeal(app);

    const res = await request(app, `/api/diet/entries/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        eatenAt: "2026-11-08T07:15:00.000Z",
        timezone: "Europe/Oslo",
      }),
    });

    expect(res.status).toBe(200);
    expect(store.rows[0]?.entry).toMatchObject({
      eatenDate: "2026-11-08",
      eatenTime: "08:15",
    });
  });

  it("re-analyses the stored thumbnail when no new photo is sent", async () => {
    const seen: FoodAnalysisInput[] = [];
    const { app } = makeApp({
      analyze: (_provider, _credentials, input) => {
        seen.push(input);
        return Promise.resolve({ analysis, model: "test/model" });
      },
    });
    const created = await createMeal(app, { photoDataUrl: fullPhoto });

    const res = await request(app, `/api/diet/entries/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "The sandwich, with an apple" }),
    });

    expect(res.status).toBe(200);
    expect(seen[1]?.photoDataUrl).toBe(generatedThumbnail);
  });

  it("replaces the photo and stores its new thumbnail", async () => {
    const newPhoto = "data:image/png;base64,REVG";
    const newAnalysisPhoto = "data:image/jpeg;base64,BwgJ";
    const newThumbnail = "data:image/jpeg;base64,BAUG";
    const storedPhotos: string[] = [];
    const seen: FoodAnalysisInput[] = [];
    const { app, store } = makeApp({
      createPhotos: (dataUrl) => {
        storedPhotos.push(dataUrl);
        return Promise.resolve(
          dataUrl === fullPhoto
            ? {
                analysisDataUrl: generatedAnalysisPhoto,
                thumbnailDataUrl: generatedThumbnail,
              }
            : {
                analysisDataUrl: newAnalysisPhoto,
                thumbnailDataUrl: newThumbnail,
              },
        );
      },
      analyze: (_provider, _credentials, input) => {
        seen.push(input);
        return Promise.resolve({ analysis, model: "test/model" });
      },
    });
    const created = await createMeal(app, { photoDataUrl: fullPhoto });

    const res = await request(app, `/api/diet/entries/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ photoDataUrl: newPhoto }),
    });

    expect(res.status).toBe(200);
    expect(storedPhotos).toEqual([fullPhoto, newPhoto]);
    expect(seen[1]?.photoDataUrl).toBe(newAnalysisPhoto);
    expect(store.rows[0]?.entry.thumbnailDataUrl).toBe(newThumbnail);
  });

  it("removes a photo from a meal that still has a description", async () => {
    const { app, store } = makeApp();
    const created = await createMeal(app, { photoDataUrl: fullPhoto });

    const res = await request(app, `/api/diet/entries/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ removePhoto: true }),
    });

    expect(res.status).toBe(200);
    const updated = (await res.json()) as { hasPhoto: boolean };
    expect(updated.hasPhoto).toBe(false);
    expect(store.rows[0]?.entry.thumbnailDataUrl).toBeNull();
  });

  it("refuses an edit that leaves neither a description nor a photo", async () => {
    const { app, store } = makeApp();
    // The stored meal is a photo alone, so clearing the photo would leave
    // nothing to analyse.
    const created = await createMeal(app, {
      photoDataUrl: fullPhoto,
      description: null,
    });

    const res = await request(app, `/api/diet/entries/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ removePhoto: true }),
    });

    expect(res.status).toBe(400);
    expect(store.rows[0]?.entry.thumbnailDataUrl).toBe(generatedThumbnail);
  });

  it("keeps the edited meal when the coach cannot analyse it", async () => {
    let calls = 0;
    const { app, store } = makeApp({
      analyze: () => {
        calls += 1;
        return calls === 1
          ? Promise.resolve({ analysis, model: "test/model" })
          : Promise.reject(new Error("model unavailable"));
      },
    });
    const created = await createMeal(app);

    const res = await request(app, `/api/diet/entries/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "A larger sandwich" }),
    });

    expect(res.status).toBe(200);
    const updated = (await res.json()) as {
      description: string;
      analysis: unknown;
      analysisError: string | null;
    };
    expect(updated.description).toBe("A larger sandwich");
    expect(updated.analysis).toBeNull();
    expect(updated.analysisError).toBe("model unavailable");
    expect(store.rows[0]?.entry.description).toBe("A larger sandwich");
  });

  it("returns 404 for a meal that does not exist", async () => {
    const { app } = makeApp();
    const res = await request(app, "/api/diet/entries/9999", {
      method: "PATCH",
      body: JSON.stringify({ description: "A sandwich" }),
    });
    expect(res.status).toBe(404);
  });

  it("refuses to edit a meal when diet advice is off", async () => {
    const { app } = makeApp({ dietAdvice: false });
    const res = await request(app, "/api/diet/entries/1", {
      method: "PATCH",
      body: JSON.stringify({ description: "A sandwich" }),
    });
    expect(res.status).toBe(409);
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
      goalProvided?: boolean;
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
        updatedAt: new Date("2026-11-07T12:00:00Z"),
      },
    });
    const app = makeApp({
      store,
      planStore: planStoreWith({
        goal: "Lose 3 kg by March",
        goalProvided: true,
        assessment: "The trend is on target for the goal.",
      }),
      loadDayCalorieTargets: () =>
        Promise.resolve(
          new Map([
            [
              "2026-11-07",
              {
                caloriesKcal: 2400,
                calorieBreakdown: {
                  basalMetabolismKcal: 1900,
                  workoutCaloriesKcal: 500,
                  dietDeficitKcal: 0,
                },
              },
            ],
          ]),
        ),
    }).app;

    const res = await request(app, "/api/diet/summary?today=2026-11-07");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as {
      goal: string;
      goalProvided: boolean;
      assessment: string;
      days: {
        date: string;
        neededCaloriesKcal: number;
        calorieBreakdown: {
          basalMetabolismKcal: number;
          workoutCaloriesKcal: number;
          dietDeficitKcal: number;
        } | null;
        consumedCaloriesKcal: number;
        balanceKcal: number;
        entries: unknown[];
      }[];
    };
    expect(parsed.goal).toBe("Lose 3 kg by March");
    expect(parsed.goalProvided).toBe(true);
    expect(parsed.assessment).toContain("on target");
    expect(parsed.days[0]).toMatchObject({
      date: "2026-11-07",
      neededCaloriesKcal: 2400,
      calorieBreakdown: {
        basalMetabolismKcal: 1900,
        workoutCaloriesKcal: 500,
        dietDeficitKcal: 0,
      },
      consumedCaloriesKcal: 420,
      balanceKcal: -1980,
    });
    expect(parsed.days[0]?.entries).toHaveLength(1);
  });

  it("infers whether an older plan's goal was the default", async () => {
    const fallback = makeApp({
      planStore: planStoreWith({
        goal: "Maintain current weight",
        assessment: "Holding.",
      }),
      loadDayCalorieTargets: () => Promise.resolve(new Map()),
    }).app;
    const fallbackRes = await request(
      fallback,
      "/api/diet/summary?today=2026-11-07",
    );
    expect(
      ((await fallbackRes.json()) as { goalProvided: boolean }).goalProvided,
    ).toBe(false);

    const custom = makeApp({
      planStore: planStoreWith({
        goal: "Lose 3 kg by March",
        assessment: "On target.",
      }),
      loadDayCalorieTargets: () => Promise.resolve(new Map()),
    }).app;
    const customRes = await request(
      custom,
      "/api/diet/summary?today=2026-11-07",
    );
    expect(
      ((await customRes.json()) as { goalProvided: boolean }).goalProvided,
    ).toBe(true);
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
