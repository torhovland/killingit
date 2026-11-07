import { describe, expect, it } from "bun:test";
import type { FoodAnalysis } from "@killingit/shared";
import { createApp } from "../index.js";
import type { LlmClient } from "../llm/client.js";
import type { PlanContextInput } from "../llm/planContext.js";
import type { LlmProvider } from "../llm/openrouter.js";
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
        ?.entry.photoDataUrl ?? null,
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
    loadLlm: () => Promise.resolve(llm),
    loadFoodContext: () => Promise.resolve(context),
    analyzeFood,
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
        photoDataUrl: "data:image/jpeg;base64,AQID",
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

describe("GET /api/diet/entries/:id/photo", () => {
  it("serves the stored photo to its owner", async () => {
    const { app } = makeApp();
    const created = await request(app, "/api/diet/entries", {
      method: "POST",
      body: JSON.stringify({
        ...body,
        photoDataUrl: "data:image/jpeg;base64,AQID",
      }),
    });
    const entry = (await created.json()) as { id: number };

    const res = await request(app, `/api/diet/entries/${entry.id}/photo`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
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
