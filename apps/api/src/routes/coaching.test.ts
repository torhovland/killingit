import { describe, expect, it } from "bun:test";
import type { ActivityFeed } from "../coaching/activities.js";
import { createApp, type AppDependencies } from "../index.js";
import type { CoachingInputs } from "../plans/inputs.js";
import type {
  PlanGenerationStore,
  PlanStore,
  StoredPlan,
} from "../plans/store.js";
import { idleGenerationStatus } from "../plans/store.js";
import type {
  QuestionAnswerStore,
  StoredAthleteQuestion,
} from "../questions/answers.js";

const storedQuestion: StoredAthleteQuestion = {
  id: 1,
  versionId: 1,
  prompt: "What is your goal?",
  required: true,
  version: 1,
  versionCount: 1,
  createdAt: new Date("2026-10-20T09:00:00Z"),
  updatedAt: new Date("2026-10-20T09:00:00Z"),
  answer: "Run a marathon.",
  skipped: false,
  answeredAt: new Date("2026-10-20T10:00:00Z"),
};

const emptyInputs: CoachingInputs = {
  manualActivities: [],
  activityComments: [],
  weeklyNote: null,
  updatedAt: null,
};

class MemoryPlanStore implements PlanStore {
  constructor(public stored: StoredPlan | null) {}

  load(): Promise<StoredPlan | null> {
    return Promise.resolve(this.stored);
  }

  save(
    _userId: number,
    plan: StoredPlan["plan"],
    answersUpdatedAt: Date | null,
    coachingInputsUpdatedAt: Date | null = null,
  ): Promise<StoredPlan> {
    this.stored = {
      plan,
      answersUpdatedAt,
      coachingInputsUpdatedAt,
      generatedAt: new Date(),
    };
    return Promise.resolve(this.stored);
  }
}

class MemoryGenerationStore implements PlanGenerationStore {
  status = idleGenerationStatus();
  running = false;

  load() {
    return Promise.resolve(this.status);
  }

  begin() {
    if (this.running) {
      return Promise.resolve(false);
    }
    this.running = true;
    this.status = {
      ...this.status,
      status: "running",
      step: "Preparing your plan",
      progress: 5,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve(true);
  }

  update(_userId: number, step: string, progress: number) {
    this.status = {
      ...this.status,
      status: "running",
      step,
      progress,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve();
  }

  finish() {
    this.running = false;
    this.status = {
      ...this.status,
      status: "done",
      step: "Your plan is ready",
      progress: 100,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve();
  }

  fail(_userId: number, error: string) {
    this.running = false;
    this.status = {
      ...this.status,
      status: "error",
      error,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve();
  }
}

function makeApp(options: {
  planStore?: PlanStore;
  generationStore?: PlanGenerationStore;
  answers?: QuestionAnswerStore;
  loadActivities?: (userId: number) => Promise<ActivityFeed>;
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
  saveActivityComment?: (
    userId: number,
    input: { activityId: string; comment: string },
  ) => Promise<void>;
  saveManualActivity?: (
    userId: number,
    activity: {
      startDate: string;
      details: string;
    },
  ) => Promise<number>;
  saveWeeklyNote?: (
    userId: number,
    today: string,
    note: string,
  ) => Promise<void>;
  deleteImportedActivity?: (
    userId: number,
    activityId: string,
  ) => Promise<void>;
  deleteManualActivity?: (
    userId: number,
    activityId: number,
  ) => Promise<boolean>;
  replyToCoachingInput?: AppDependencies["replyToCoachingInput"];
  loadManualActivities?: AppDependencies["loadManualActivities"];
  loadManualActivityReplies?: AppDependencies["loadManualActivityReplies"];
  loadWeeklyNote?: AppDependencies["loadWeeklyNote"];
  loadWeeklyNoteReply?: AppDependencies["loadWeeklyNoteReply"];
  triggerPlanGeneration?: AppDependencies["triggerPlanGeneration"];
}) {
  return createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "athlete-1" }) },
    userStore: {
      ensureUser: (sub) =>
        Promise.resolve({
          id: 42,
          sub,
          role: "member",
          createdAt: new Date(0),
        }),
    },
    answerStore:
      options.answers ??
      ({
        listForUser: () => Promise.resolve([storedQuestion]),
        saveAnswers: () => Promise.resolve(true),
      } satisfies QuestionAnswerStore),
    planStore: options.planStore ?? new MemoryPlanStore(null),
    generationStore: options.generationStore ?? new MemoryGenerationStore(),
    loadActivities:
      options.loadActivities ??
      (() => Promise.resolve({ model: "test-model", activities: [] })),
    loadLlm: () =>
      Promise.resolve({
        provider: {
          id: "fake",
          listModels: () => Promise.resolve([]),
          validateKey: () => Promise.resolve(),
          complete: () => Promise.reject(new Error("not used")),
        },
        apiKey: "test-key",
        model: "test-model",
      }),
    loadCoachingInputs:
      options.loadCoachingInputs ?? (() => Promise.resolve(emptyInputs)),
    replyToCoachingInput:
      options.replyToCoachingInput ?? (() => Promise.resolve(null)),
    loadManualActivities:
      options.loadManualActivities ?? (() => Promise.resolve([])),
    loadManualActivityReplies:
      options.loadManualActivityReplies ?? (() => Promise.resolve(new Map())),
    loadWeeklyNote: options.loadWeeklyNote ?? (() => Promise.resolve(null)),
    loadWeeklyNoteReply:
      options.loadWeeklyNoteReply ?? (() => Promise.resolve(null)),
    ...(options.saveActivityComment !== undefined
      ? { saveActivityComment: options.saveActivityComment }
      : {}),
    ...(options.saveManualActivity !== undefined
      ? { saveManualActivity: options.saveManualActivity }
      : {}),
    ...(options.saveWeeklyNote !== undefined
      ? { saveWeeklyNote: options.saveWeeklyNote }
      : {}),
    ...(options.deleteImportedActivity !== undefined
      ? { deleteImportedActivity: options.deleteImportedActivity }
      : {}),
    ...(options.deleteManualActivity !== undefined
      ? { deleteManualActivity: options.deleteManualActivity }
      : {}),
    ...(options.triggerPlanGeneration !== undefined
      ? { triggerPlanGeneration: options.triggerPlanGeneration }
      : {}),
  });
}

function authenticatedRequest(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer anything");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

describe("coaching activity feed", () => {
  it("loads activities for the signed-in account", async () => {
    const requested = { userId: null as number | null };
    const app = makeApp({
      loadActivities: (userId) => {
        requested.userId = userId;
        return Promise.resolve({ model: "test-model", activities: [] });
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities"),
    );

    expect(res.status).toBe(200);
    expect(requested.userId).toBe(42);
  });
});

describe("coaching activity comments", () => {
  it("saves a comment, replies, and keeps today's session for today's activity", async () => {
    const saved: {
      value: { userId: number; activityId: string; comment: string } | null;
    } = { value: null };
    let keepToday: boolean | undefined;

    const app = makeApp({
      saveActivityComment: (userId, input) => {
        saved.value = { userId, ...input };
        return Promise.resolve();
      },
      replyToCoachingInput: () =>
        Promise.resolve({
          kind: "activity_comment",
          target: "123",
          text: "Good work; I will keep Thursday easy.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T12:00:00Z"),
        }),
      triggerPlanGeneration: (_deps, options) => {
        keepToday = options.keepToday;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-21",
          comment: "Felt strong on the hills.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(saved.value).toEqual({
      userId: 42,
      activityId: "123",
      comment: "Felt strong on the hills.",
    });
    expect(keepToday).toBe(true);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply?.text).toBe("Good work; I will keep Thursday easy.");
  });

  it("does not keep today's session for an earlier activity", async () => {
    let keepToday: boolean | undefined;
    const app = makeApp({
      saveActivityComment: () => Promise.resolve(),
      triggerPlanGeneration: (_deps, options) => {
        keepToday = options.keepToday;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-19",
          comment: "Felt strong on the hills.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(keepToday).toBe(false);
  });

  it("rejects a comment without an activity date", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          comment: "Felt strong.",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an empty comment", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-21",
          comment: "",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("coaching manual activities", () => {
  it("saves a manual activity, replies, and keeps today's session when dated today", async () => {
    const savedDetails: { value: string | null } = { value: null };
    let keepToday: boolean | undefined;
    const repliedTo: { target: number | null } = { target: null };

    const app = makeApp({
      saveManualActivity: (_userId, activity) => {
        savedDetails.value = activity.details;
        return Promise.resolve(7);
      },
      replyToCoachingInput: (_deps, options) => {
        repliedTo.target =
          options.request.kind === "manual_activity"
            ? options.request.manualActivityId
            : null;
        return Promise.resolve({
          kind: "manual_activity",
          target: "7",
          text: "Noted; I will count the swim as today's session.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T12:00:00Z"),
        });
      },
      triggerPlanGeneration: (_deps, options) => {
        keepToday = options.keepToday;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          startDate: "2026-10-21",
          details: "Pool swim",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(savedDetails.value).toBe("Pool swim");
    expect(repliedTo.target).toBe(7);
    expect(keepToday).toBe(true);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply?.text).toContain("swim");
  });

  it("rejects a manual activity without details", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          startDate: "2026-10-20",
          details: "",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns saved manual activities with their coach replies", async () => {
    const app = makeApp({
      loadManualActivities: () =>
        Promise.resolve([
          { id: 7, startDate: "2026-10-21", details: "Pool swim" },
        ]),
      loadManualActivityReplies: () =>
        Promise.resolve(
          new Map([
            [
              7,
              {
                kind: "manual_activity" as const,
                target: "7",
                text: "Nice session.",
                model: "test-model",
                generatedAt: new Date("2026-10-21T12:00:00Z"),
              },
            ],
          ]),
        ),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/manual"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      manualActivities: Array<{ coachReply: { text: string } | null }>;
    };
    expect(body.manualActivities[0]?.coachReply?.text).toBe("Nice session.");
  });

  it("deletes a manual activity and triggers a plan revision", async () => {
    const deleted: { userId: number | null; id: number | null } = {
      userId: null,
      id: null,
    };
    let triggered = false;

    const app = makeApp({
      deleteManualActivity: (userId, activityId) => {
        deleted.userId = userId;
        deleted.id = activityId;
        return Promise.resolve(true);
      },
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest(
        "/api/coaching/activities/manual/7?today=2026-10-21",
        {
          method: "DELETE",
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(deleted).toEqual({ userId: 42, id: 7 });
    expect(triggered).toBe(true);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Manual activity deleted");
  });

  it("returns 404 when deleting an unknown manual activity", async () => {
    const app = makeApp({
      deleteManualActivity: () => Promise.resolve(false),
    });

    const res = await app.fetch(
      authenticatedRequest(
        "/api/coaching/activities/manual/7?today=2026-10-21",
        {
          method: "DELETE",
        },
      ),
    );

    expect(res.status).toBe(404);
  });
});

describe("coaching activity deletion", () => {
  it("deletes an imported activity and triggers a plan revision", async () => {
    const deleted: { userId: number | null; activityId: string | null } = {
      userId: null,
      activityId: null,
    };
    let triggered = false;

    const app = makeApp({
      deleteImportedActivity: (userId, activityId) => {
        deleted.userId = userId;
        deleted.activityId = activityId;
        return Promise.resolve();
      },
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123?today=2026-10-21", {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(200);
    expect(deleted).toEqual({ userId: 42, activityId: "123" });
    expect(triggered).toBe(true);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Activity deleted");
  });

  it("requires a today date when deleting an activity", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123", {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe("coaching weekly notes", () => {
  it("saves a weekly note, replies, and triggers plan generation", async () => {
    const savedNote: { value: string | null } = { value: null };
    let triggered = false;

    const app = makeApp({
      saveWeeklyNote: (_userId, _today, note) => {
        savedNote.value = note;
        return Promise.resolve();
      },
      replyToCoachingInput: () =>
        Promise.resolve({
          kind: "weekly_note",
          target: "2026-10-19",
          text: "Understood; Thursday will be a rest day.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T12:00:00Z"),
        }),
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/weekly/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          note: "I cannot train on Thursday this week.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(savedNote.value).toBe("I cannot train on Thursday this week.");
    expect(triggered).toBe(true);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply?.text).toContain("Thursday");
  });

  it("returns the saved note with its coach reply", async () => {
    const app = makeApp({
      loadWeeklyNote: () => Promise.resolve("No training on Thursday."),
      loadWeeklyNoteReply: () =>
        Promise.resolve({
          kind: "weekly_note",
          target: "2026-10-19",
          text: "Understood; Thursday will be a rest day.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T12:00:00Z"),
        }),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/weekly/notes?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      note: string | null;
      reply: { text: string } | null;
    };
    expect(body.note).toBe("No training on Thursday.");
    expect(body.reply?.text).toContain("rest day");
  });

  it("rejects an empty weekly note", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/weekly/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21", note: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
