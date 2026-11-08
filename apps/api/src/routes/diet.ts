import {
  dietSummaryResponseSchema,
  foodEntriesResponseSchema,
  foodEntryRequestSchema,
  foodEntrySchema,
  foodEntryUpdateRequestSchema,
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
import type { ResolvedAppDependencies } from "../dependencies.js";
import type { PlanContextInput } from "../llm/planContext.js";
import { loadLlmClient, type LlmClient } from "../llm/client.js";
import { analyzeFood } from "../llm/foodAnalysis.js";
import type { PreviousFoodAnalysis } from "../llm/foodPrompt.js";
import { localDateTimeInZone, addDays } from "../plans/dates.js";
import { loadPlanDayCalorieTargets } from "../plans/dayCalories.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import { buildDietSummary } from "../diet/days.js";
import { toFoodEntry } from "../diet/presenter.js";
import { dbFoodEntryStore } from "../diet/store.js";
import { createMealThumbnail } from "../diet/thumbnail.js";

/** The reported reason when no provider is configured. */
const NO_LLM_ERROR =
  "The coach needs an OpenRouter key and model. Add them in Settings, then save the meal again.";

/** How far back the summary looks when the athlete has logged nothing. */
const EMPTY_SUMMARY_DAYS = 30;

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

/** The meal fields the coach needs to analyse a meal. */
interface MealAnalysisRequest {
  userId: number;
  today: string;
  eatenDate: string;
  eatenTime: string;
  description: string | null;
  photoDataUrl: string | null;
  /** The stored meal before an edit, so the coach can adjust its assessment. */
  previous?: PreviousFoodAnalysis;
}

/**
 * Asks the coach to describe one meal and estimate its macros. A failed
 * analysis is reported rather than thrown, because the meal itself must still
 * be saved.
 */
async function analyseMeal(
  request: MealAnalysisRequest,
  deps: {
    answers: QuestionAnswerStore;
    loadLlm: (userId: number) => Promise<LlmClient | null>;
    loadContext: (input: ReplyContextInput) => Promise<PlanContextInput>;
    analyze: typeof analyzeFood;
  },
): Promise<{
  analysis: FoodAnalysis | null;
  model: string | null;
  analysisError: string | null;
}> {
  try {
    const llm = await deps.loadLlm(request.userId);
    if (llm === null) {
      return { analysis: null, model: null, analysisError: NO_LLM_ERROR };
    }
    const answers = await deps.answers.listForUser(request.userId);
    const context = await deps.loadContext({
      userId: request.userId,
      today: request.today,
      athleteAnswers: answers.map(toAnswerContext),
    });
    const result = await deps.analyze(
      llm.provider,
      { apiKey: llm.apiKey, model: llm.model },
      {
        context,
        eatenDate: request.eatenDate,
        eatenTime: request.eatenTime,
        description: request.description,
        photoDataUrl: request.photoDataUrl,
        ...(request.previous !== undefined
          ? { previous: request.previous }
          : {}),
      },
    );
    return {
      analysis: result.analysis,
      model: result.model,
      analysisError: null,
    };
  } catch (err) {
    console.error("[diet] food analysis failed:", err);
    return {
      analysis: null,
      model: null,
      analysisError:
        err instanceof Error
          ? err.message
          : "The coach could not analyse this meal.",
    };
  }
}

/**
 * The diet log. Logging requires the athlete to have enabled diet advice; the
 * meal is stored even when the coach cannot analyse it, so nothing the athlete
 * typed is lost. Editing a meal re-runs the analysis with the new fields.
 * Photos are served from their own authenticated endpoint.
 */
export function createDietRoute(deps: ResolvedAppDependencies): Hono {
  const entries = deps.dietEntries ?? dbFoodEntryStore;
  const loadTargets = deps.loadDayCalorieTargets ?? loadPlanDayCalorieTargets;
  const llmLoader = deps.loadLlm ?? loadLlmClient;
  const loadContext = deps.loadFoodContext ?? loadReplyContext;
  const analyze = deps.analyzeFood ?? analyzeFood;
  const createThumbnail = deps.createMealThumbnail ?? createMealThumbnail;

  return new Hono()
    .get("/summary", async (c) => {
      const today = planDateSchema.safeParse(c.req.query("today"));
      if (!today.success) {
        return c.text("A valid today date (YYYY-MM-DD) is required", 400);
      }
      const user = await deps.userStore.ensureUser(getAthlete(c).sub);
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
        deps.planStore.load(user.id),
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
      const user = await deps.userStore.ensureUser(getAthlete(c).sub);
      const stored = await entries.listForUser(user.id);
      return c.json(
        foodEntriesResponseSchema.parse({
          entries: stored.map(toFoodEntry),
        }),
      );
    })
    .post("/entries", zValidator("json", foodEntryRequestSchema), async (c) => {
      const user = await deps.userStore.ensureUser(getAthlete(c).sub);
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

      const result = await analyseMeal(
        {
          userId: user.id,
          today,
          eatenDate: local.date,
          eatenTime: local.time,
          description,
          photoDataUrl,
        },
        {
          answers: deps.answerStore,
          loadLlm: llmLoader,
          loadContext,
          analyze,
        },
      );

      const stored = await entries.create(user.id, {
        eatenAt,
        eatenDate: local.date,
        eatenTime: local.time,
        description,
        thumbnailDataUrl,
        analysis: result.analysis,
        model: result.model,
        analysisError: result.analysisError,
      });
      return c.json(foodEntrySchema.parse(toFoodEntry(stored)), 201);
    })
    .patch(
      "/entries/:id",
      zValidator("json", foodEntryUpdateRequestSchema),
      async (c) => {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id) || id <= 0) {
          return c.text("Invalid meal", 400);
        }
        const user = await deps.userStore.ensureUser(getAthlete(c).sub);
        if (!user.dietAdvice) {
          return c.text(
            "Diet advice is not enabled. Turn it on in Settings first.",
            409,
          );
        }
        const existing = await entries.findForUser(user.id, id);
        if (existing === null) {
          return c.text("Meal not found", 404);
        }

        const input = c.req.valid("json");
        const eatenAt =
          input.eatenAt === undefined
            ? existing.eatenAt
            : new Date(input.eatenAt);
        const timezone = input.timezone ?? user.timezone;
        const local = localDateTimeInZone(eatenAt, timezone);
        const today =
          input.today ?? localDateTimeInZone(new Date(), timezone).date;
        const description =
          input.description === undefined
            ? existing.description
            : input.description?.trim() || null;

        // An edit without a new photo re-analyses the stored thumbnail, because
        // the full-resolution original is never kept. Removing the photo sends
        // no image at all.
        let thumbnailDataUrl = existing.thumbnailDataUrl;
        let photoDataUrl = existing.thumbnailDataUrl;
        const newPhoto = input.photoDataUrl ?? null;
        if (newPhoto !== null) {
          try {
            thumbnailDataUrl = await createThumbnail(newPhoto);
          } catch (err) {
            console.error("[diet] could not create the meal thumbnail:", err);
            return c.text(
              "The photo could not be read. Try another photo.",
              400,
            );
          }
          photoDataUrl = newPhoto;
        } else if (input.removePhoto === true) {
          thumbnailDataUrl = null;
          photoDataUrl = null;
        }

        if (description === null && thumbnailDataUrl === null) {
          return c.text("Describe the meal or keep a photo.", 400);
        }

        const result = await analyseMeal(
          {
            userId: user.id,
            today,
            eatenDate: local.date,
            eatenTime: local.time,
            description,
            photoDataUrl,
            previous: {
              description: existing.description,
              analysis: existing.analysis,
            },
          },
          {
            answers: deps.answerStore,
            loadLlm: llmLoader,
            loadContext,
            analyze,
          },
        );

        const stored = await entries.update(user.id, id, {
          eatenAt,
          eatenDate: local.date,
          eatenTime: local.time,
          description,
          thumbnailDataUrl,
          analysis: result.analysis,
          model: result.model,
          analysisError: result.analysisError,
        });
        if (stored === null) {
          return c.text("Meal not found", 404);
        }
        return c.json(foodEntrySchema.parse(toFoodEntry(stored)));
      },
    )
    .get("/entries/:id/photo", async (c) => {
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id) || id <= 0) {
        return c.text("Invalid meal", 400);
      }
      const user = await deps.userStore.ensureUser(getAthlete(c).sub);
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
          // A meal's photo can be replaced, so the browser must revalidate. The
          // client adds the entry's updatedAt to the URL for a fresh read.
          "cache-control": "private, no-cache",
        },
      });
    });
}
