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
  loadCachedFeed?: AppDependencies["loadCachedFeed"];
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
  createActivityComment?: (
    userId: number,
    input: { activityId: string; comment: string },
  ) => Promise<boolean>;
  updateActivityComment?: (
    userId: number,
    input: { activityId: string; comment: string },
  ) => Promise<boolean>;
  saveActivityReview?: AppDependencies["saveActivityReview"];
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
  answerCoachingQuestion?: AppDependencies["answerCoachingQuestion"];
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
          timezone: null,
          createdAt: new Date(0),
        }),
      updateTimezone: (sub, timezone) =>
        Promise.resolve({
          id: 42,
          sub,
          role: "member",
          timezone,
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
    ...(options.loadCachedFeed !== undefined
      ? { loadCachedFeed: options.loadCachedFeed }
      : {}),
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
    answerCoachingQuestion:
      options.answerCoachingQuestion ?? (() => Promise.resolve(null)),
    loadManualActivities:
      options.loadManualActivities ?? (() => Promise.resolve([])),
    loadManualActivityReplies:
      options.loadManualActivityReplies ?? (() => Promise.resolve(new Map())),
    loadWeeklyNote: options.loadWeeklyNote ?? (() => Promise.resolve(null)),
    loadWeeklyNoteReply:
      options.loadWeeklyNoteReply ?? (() => Promise.resolve(null)),
    ...(options.createActivityComment !== undefined
      ? { createActivityComment: options.createActivityComment }
      : {}),
    ...(options.updateActivityComment !== undefined
      ? { updateActivityComment: options.updateActivityComment }
      : {}),
    ...(options.saveActivityReview !== undefined
      ? { saveActivityReview: options.saveActivityReview }
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

  it("returns the stored feed without syncing Garmin", async () => {
    const requested = { userId: null as number | null };
    const app = makeApp({
      loadCachedFeed: (userId) => {
        requested.userId = userId;
        return Promise.resolve({
          model: "test-model",
          activities: [
            {
              id: 7,
              name: "Morning Run",
              type: "running",
              startDate: "2026-10-21T06:30:00Z",
              distance: 5000,
              movingTime: 1500,
              elapsedTime: 1600,
              totalElevationGain: 20,
              sampleCount: 10,
              analysis: null,
              analysisError: null,
              programAnalysis: null,
              comment: null,
              coachReply: null,
            },
          ],
        });
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/cached"),
    );

    expect(res.status).toBe(200);
    expect(requested.userId).toBe(42);
    const body = (await res.json()) as { activities: Array<{ name: string }> };
    expect(body.activities[0]?.name).toBe("Morning Run");
  });

  it("returns an empty feed when nothing has been cached yet", async () => {
    const app = makeApp({
      loadCachedFeed: () => Promise.resolve(null),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/cached"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ model: null, activities: [] });
  });
});

describe("coaching activity comments", () => {
  it("saves a comment, replies, and keeps today's session for today's activity", async () => {
    const saved: {
      value: { userId: number; activityId: string; comment: string } | null;
    } = { value: null };
    let keepToday: boolean | undefined;

    const app = makeApp({
      createActivityComment: (userId, input) => {
        saved.value = { userId, ...input };
        return Promise.resolve(true);
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
      createActivityComment: () => Promise.resolve(true),
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

  it("refuses to add a second comment to the same activity", async () => {
    let triggered = false;
    const app = makeApp({
      createActivityComment: () => Promise.resolve(false),
      triggerPlanGeneration: () => {
        triggered = true;
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
          comment: "A second comment.",
        }),
      }),
    );

    expect(res.status).toBe(409);
    expect(triggered).toBe(false);
  });

  it("edits the existing comment, refreshes the coach reply, and triggers a plan revision", async () => {
    const saved: {
      value: { userId: number; activityId: string; comment: string } | null;
    } = { value: null };
    const repliedTo: { comment: string | null } = { comment: null };
    let triggered = false;

    const app = makeApp({
      updateActivityComment: (userId, input) => {
        saved.value = { userId, ...input };
        return Promise.resolve(true);
      },
      replyToCoachingInput: (_deps, options) => {
        repliedTo.comment =
          options.request.kind === "activity_comment"
            ? options.request.comment
            : null;
        return Promise.resolve({
          kind: "activity_comment",
          target: "123",
          text: "Updated reply.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T12:00:00Z"),
        });
      },
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-19",
          comment: "On reflection, the hills felt harder than I said.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(saved.value).toEqual({
      userId: 42,
      activityId: "123",
      comment: "On reflection, the hills felt harder than I said.",
    });
    expect(repliedTo.comment).toBe(
      "On reflection, the hills felt harder than I said.",
    );
    expect(triggered).toBe(true);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply?.text).toBe("Updated reply.");
  });

  it("returns 404 when editing an activity without a comment", async () => {
    let triggered = false;
    const app = makeApp({
      updateActivityComment: () => Promise.resolve(false),
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-21",
          comment: "A comment that does not exist yet.",
        }),
      }),
    );

    expect(res.status).toBe(404);
    expect(triggered).toBe(false);
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

describe("coaching activity review", () => {
  it("marks an activity as reviewed without triggering a plan revision", async () => {
    const reviewed: {
      value: { userId: number; activityId: string } | null;
    } = { value: null };
    let triggered = false;

    const app = makeApp({
      saveActivityReview: (userId, activityId) => {
        reviewed.value = { userId, activityId };
        return Promise.resolve();
      },
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/reviewed", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(200);
    expect(reviewed.value).toEqual({ userId: 42, activityId: "123" });
    expect(triggered).toBe(false);
  });
});

describe("coaching by-the-way questions", () => {
  it("returns the coach's answer without saving or revising the plan", async () => {
    const received: {
      value: { userId: number; question: string } | null;
    } = { value: null };
    let triggered = false;

    const app = makeApp({
      answerCoachingQuestion: (_deps, options) => {
        received.value = {
          userId: options.userId,
          question: options.question,
        };
        return Promise.resolve({
          text: "Run it on Saturday.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T12:00:00Z"),
        });
      },
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          question: "Should I run on Saturday or Sunday?",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(received.value).toEqual({
      userId: 42,
      question: "Should I run on Saturday or Sunday?",
    });
    expect(triggered).toBe(false);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply?.text).toBe("Run it on Saturday.");
  });

  it("rejects an empty question", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21", question: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
