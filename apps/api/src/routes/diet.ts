import {
  dietSummaryResponseSchema,
  foodEntriesResponseSchema,
  foodEntryRequestSchema,
  foodEntrySchema,
  isDefaultDietGoal,
  planDateSchema,
  type FoodAnalysis,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import { toAnswerContext } from "../coaching/replies.js";
import {
  loadReplyContext,
  type ReplyContextInput,
} from "../coaching/replyContext.js";
import type { PlanContextInput } from "../llm/planContext.js";
import { loadLlmClient, type LlmClient } from "../llm/client.js";
import { analyzeFood } from "../llm/foodAnalysis.js";
import { localDateTimeInZone, addDays } from "../plans/dates.js";
import { loadPlanDayCalories } from "../plans/dayCalories.js";
import type { PlanStore } from "../plans/store.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import { type UserStore } from "../users/store.js";
import { buildDietSummary } from "../diet/days.js";
import { toFoodEntry } from "../diet/presenter.js";
import { dbFoodEntryStore, type FoodEntryStore } from "../diet/store.js";
import { createMealThumbnail } from "../diet/thumbnail.js";

/** The reported reason when no provider is configured. */
const NO_LLM_ERROR =
  "The coach needs an OpenRouter key and model. Add them in Settings, then log the meal again.";

/** How far back the summary looks when the athlete has logged nothing. */
const EMPTY_SUMMARY_DAYS = 30;

export interface DietRouteDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  entries?: FoodEntryStore;
  plans?: PlanStore;
  /** Injectable for route tests; defaults to the stored plan's calorie targets. */
  loadTargets?: typeof loadPlanDayCalories;
  /** Injectable for route tests; defaults to the account's stored config. */
  loadLlm?: (userId: number) => Promise<LlmClient | null>;
  /** Injectable for route tests; defaults to the stored reply context. */
  loadContext?: (input: ReplyContextInput) => Promise<PlanContextInput>;
  /** Injectable for route tests; defaults to the real food analysis. */
  analyze?: typeof analyzeFood;
  /** Injectable for route tests; defaults to the Jimp thumbnail generator. */
  createThumbnail?: typeof createMealThumbnail;
}

/** Decodes a stored image data URL into its MIME type and bytes. */
function decodePhoto(dataUrl: string): {
  contentType: string;
  bytes: Uint8Array;
} | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (match?.[1] === undefined || match[2] === undefined) {
    return null;
  }
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { contentType: match[1], bytes };
  } catch {
    return null;
  }
}

/**
 * The diet log. Logging requires the athlete to have enabled diet advice; the
 * meal is stored even when the coach cannot analyse it, so nothing the athlete
 * typed is lost. Photos are served from their own authenticated endpoint.
 */
export function createDietRoute(deps: DietRouteDependencies): Hono {
  const entries = deps.entries ?? dbFoodEntryStore;
  const loadTargets = deps.loadTargets ?? loadPlanDayCalories;
  const llmLoader = deps.loadLlm ?? loadLlmClient;
  const loadContext = deps.loadContext ?? loadReplyContext;
  const analyze = deps.analyze ?? analyzeFood;
  const createThumbnail = deps.createThumbnail ?? createMealThumbnail;

  return new Hono()
    .get("/summary", async (c) => {
      const today = planDateSchema.safeParse(c.req.query("today"));
      if (!today.success) {
        return c.text("A valid today date (YYYY-MM-DD) is required", 400);
      }
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      if (!user.dietAdvice) {
        return c.json(
          dietSummaryResponseSchema.parse({
            goal: null,
            goalProvided: false,
            assessment: null,
            days: [],
          }),
        );
      }

      const stored = await entries.listForUser(user.id);
      const earliest =
        stored.map((entry) => entry.eatenDate).sort()[0] ??
        addDays(today.data, -EMPTY_SUMMARY_DAYS);
      const [targets, plan] = await Promise.all([
        loadTargets(user.id, earliest, today.data),
        deps.plans === undefined
          ? Promise.resolve(null)
          : deps.plans.load(user.id),
      ]);
      const diet = plan?.plan.diet ?? null;
      const goalProvided =
        diet === null
          ? false
          : (diet.goalProvided ?? !isDefaultDietGoal(diet.goal));
      return c.json(
        dietSummaryResponseSchema.parse(
          buildDietSummary({
            entries: stored,
            targets,
            goal: diet?.goal ?? null,
            goalProvided,
            assessment: diet?.assessment ?? null,
            today: today.data,
          }),
        ),
      );
    })
    .get("/entries", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const stored = await entries.listForUser(user.id);
      return c.json(
        foodEntriesResponseSchema.parse({
          entries: stored.map(toFoodEntry),
        }),
      );
    })
    .post("/entries", zValidator("json", foodEntryRequestSchema), async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      if (!user.dietAdvice) {
        return c.text(
          "Diet advice is not enabled. Turn it on in Settings first.",
          409,
        );
      }

      const input = c.req.valid("json");
      const eatenAt = new Date(input.eatenAt);
      const timezone = input.timezone ?? user.timezone;
      const local = localDateTimeInZone(eatenAt, timezone);
      const today =
        input.today ?? localDateTimeInZone(new Date(), timezone).date;
      const description = input.description?.trim() || null;
      // The full-resolution image is sent to the coach for analysis and never
      // stored; the thumbnail is generated here from the same bytes the coach
      // sees, so the two can never disagree.
      const photoDataUrl = input.photoDataUrl ?? null;
      let thumbnailDataUrl: string | null = null;
      if (photoDataUrl !== null) {
        try {
          thumbnailDataUrl = await createThumbnail(photoDataUrl);
        } catch (err) {
          console.error("[diet] could not create the meal thumbnail:", err);
          return c.text("The photo could not be read. Try another photo.", 400);
        }
      }

      let analysis: FoodAnalysis | null = null;
      let model: string | null = null;
      let analysisError: string | null = null;
      try {
        const llm = await llmLoader(user.id);
        if (llm === null) {
          analysisError = NO_LLM_ERROR;
        } else {
          const answers = await deps.answers.listForUser(user.id);
          const context = await loadContext({
            userId: user.id,
            today,
            athleteAnswers: answers.map(toAnswerContext),
          });
          const result = await analyze(
            llm.provider,
            { apiKey: llm.apiKey, model: llm.model },
            {
              context,
              eatenDate: local.date,
              eatenTime: local.time,
              description,
              photoDataUrl,
            },
          );
          analysis = result.analysis;
          model = result.model;
        }
      } catch (err) {
        analysisError =
          err instanceof Error
            ? err.message
            : "The coach could not analyse this meal.";
        console.error("[diet] food analysis failed:", err);
      }

      const stored = await entries.create(user.id, {
        eatenAt,
        eatenDate: local.date,
        eatenTime: local.time,
        description,
        thumbnailDataUrl,
        analysis,
        model,
        analysisError,
      });
      return c.json(foodEntrySchema.parse(toFoodEntry(stored)), 201);
    })
    .get("/entries/:id/photo", async (c) => {
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id) || id <= 0) {
        return c.text("Invalid meal", 400);
      }
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const dataUrl = await entries.photo(user.id, id);
      if (dataUrl === null) {
        return c.text("Photo not found", 404);
      }
      const photo = decodePhoto(dataUrl);
      if (photo === null) {
        return c.text("Photo not found", 404);
      }
      return new Response(photo.bytes, {
        status: 200,
        headers: {
          "content-type": photo.contentType,
          // The photo never changes, and only the owner can read it.
          "cache-control": "private, max-age=31536000, immutable",
        },
      });
    });
}
