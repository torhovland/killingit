import {
  addDays,
  dietSummaryResponseSchema,
  foodEntriesResponseSchema,
  foodEntryRequestSchema,
  foodEntrySchema,
  foodEntryUpdateRequestSchema,
  idParamSchema,
  type FoodAnalysis,
} from "@killingit/shared";
import { zValidator } from "../http/validation.js";
import { Hono } from "hono";
import type { Context } from "hono";
import { getUser } from "../auth/middleware.js";
import { isDietGoalProvided } from "../diet/goal.js";
import {
  athleteFailureMessage,
  badRequest,
  conflict,
  notFound,
} from "../http/errors.js";
import { todayQuerySchema } from "../http/query.js";
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
import { localDateTimeInZone } from "../plans/dates.js";
import { loadPlanDayCalorieTargets } from "../plans/dayCalories.js";
import { loadValidatedPlan } from "../plans/store.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import { buildDietSummary } from "../diet/days.js";
import { toFoodEntry } from "../diet/presenter.js";
import { dbFoodEntryStore } from "../diet/store.js";
import { createMealPhotos } from "../diet/thumbnail.js";

/** The reported reason when no provider is configured. */
const NO_LLM_ERROR =
  "The coach needs an OpenRouter key and model. Add them in Settings, then save the meal again.";

/** The reported reason when the analysis failed on something internal. */
const FOOD_ANALYSIS_ERROR = "Something went wrong on our side. Try again.";

/** The reported reason when a meal photo cannot be decoded. */
const UNREADABLE_PHOTO_MESSAGE =
  "The photo could not be read. Try another photo.";

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

/**
 * The two derived copies of a meal photo; both are null when there is no
 * photo, while a null pair means the photo could not be read.
 */
interface MealPhotoPair {
  analysisDataUrl: string | null;
  thumbnailDataUrl: string | null;
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
      { apiKey: llm.apiKey, model: llm.dailyModel },
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
    // The stored reason is shown on the Diet page and read by the next prompt,
    // so only an athlete-facing failure keeps its own message.
    return {
      analysis: null,
      model: null,
      analysisError: athleteFailureMessage(err, {
        fallback: FOOD_ANALYSIS_ERROR,
        logLabel: "[diet] food analysis failure",
      }),
    };
  }
}

/**
 * The 409 answer for a diet write the athlete has not enabled diet advice for,
 * or null when the request may continue. Settings is the only place the
 * feature is switched on.
 */
function requireDietAdvice(c: Context, dietAdvice: boolean): Response | null {
  if (dietAdvice) {
    return null;
  }
  return conflict(
    c,
    "Diet advice is not enabled. Turn it on in Settings first.",
  );
}

/** The meal fields a create or an edit may state. */
interface MealInput {
  eatenAt?: string | undefined;
  timezone?: string | undefined;
  today?: string | undefined;
  description?: string | null | undefined;
}

/** The local timing and description one meal row stores. */
interface ResolvedMeal {
  eatenAt: Date;
  eatenDate: string;
  eatenTime: string;
  /** The athlete's local day the coach is asked about. */
  today: string;
  description: string | null;
}

/**
 * Resolves a meal body into the fields its row stores. The caller supplies the
 * meal instant: a create takes it from the body, while an edit keeps the stored
 * one when the body omits it. The local date and time are derived in the body's
 * time zone, falling back to the athlete's, and an omitted description keeps
 * the stored one.
 */
function resolveMeal(
  input: MealInput,
  options: {
    eatenAt: Date;
    storedDescription: string | null;
    accountTimezone: string | null;
  },
): ResolvedMeal {
  const timezone = input.timezone ?? options.accountTimezone;
  const local = localDateTimeInZone(options.eatenAt, timezone);
  return {
    eatenAt: options.eatenAt,
    eatenDate: local.date,
    eatenTime: local.time,
    today: input.today ?? localDateTimeInZone(new Date(), timezone).date,
    description:
      input.description === undefined
        ? options.storedDescription
        : input.description?.trim() || null,
  };
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
  const createPhotos = deps.createMealPhotos ?? createMealPhotos;
  const analysisDeps = {
    answers: deps.answerStore,
    loadLlm: llmLoader,
    loadContext,
    analyze,
  };

  /**
   * Reads a meal photo into the bounded analysis copy and the stored
   * thumbnail. A missing photo yields two nulls; unreadable bytes are logged
   * and yield null, so the create and edit handlers reject with one answer.
   */
  async function processPhoto(
    photoDataUrl: string | null,
  ): Promise<MealPhotoPair | null> {
    if (photoDataUrl === null) {
      return { analysisDataUrl: null, thumbnailDataUrl: null };
    }
    try {
      return await createPhotos(photoDataUrl);
    } catch (err) {
      console.error("[diet] could not read the meal photo:", err);
      return null;
    }
  }

  return new Hono()
    .get("/summary", zValidator("query", todayQuerySchema), async (c) => {
      const { today } = c.req.valid("query");
      const user = getUser(c);
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
        addDays(today, -EMPTY_SUMMARY_DAYS);
      const [targets, plan] = await Promise.all([
        loadTargets(user.id, earliest, today),
        loadValidatedPlan(deps.planStore, user.id),
      ]);
      const diet = plan?.plan.diet ?? null;
      // The summary always reports a boolean, so no stored plan reads as "the
      // athlete stated no goal"; the tri-state helper keeps that choice here.
      const goalProvided = isDietGoalProvided(diet) ?? false;
      return c.json(
        dietSummaryResponseSchema.parse(
          buildDietSummary({
            entries: stored,
            targets,
            goal: diet?.goal ?? null,
            goalProvided,
            assessment: diet?.assessment ?? null,
            today: today,
          }),
        ),
      );
    })
    .get("/entries", async (c) => {
      const user = getUser(c);
      const stored = await entries.listForUser(user.id);
      return c.json(
        foodEntriesResponseSchema.parse({
          entries: stored.map(toFoodEntry),
        }),
      );
    })
    .post("/entries", zValidator("json", foodEntryRequestSchema), async (c) => {
      const user = getUser(c);
      const refusal = requireDietAdvice(c, user.dietAdvice);
      if (refusal !== null) {
        return refusal;
      }

      const input = c.req.valid("json");
      const meal = resolveMeal(input, {
        eatenAt: new Date(input.eatenAt),
        storedDescription: null,
        accountTimezone: user.timezone,
      });
      // The bounded analysis copy and the thumbnail are generated from the same
      // bytes, so the coach and the stored image can never disagree. Neither the
      // original nor the analysis copy is stored.
      const photos = await processPhoto(input.photoDataUrl ?? null);
      if (photos === null) {
        return badRequest(c, UNREADABLE_PHOTO_MESSAGE);
      }

      const result = await analyseMeal(
        {
          userId: user.id,
          today: meal.today,
          eatenDate: meal.eatenDate,
          eatenTime: meal.eatenTime,
          description: meal.description,
          photoDataUrl: photos.analysisDataUrl,
        },
        analysisDeps,
      );

      const stored = await entries.create(user.id, {
        eatenAt: meal.eatenAt,
        eatenDate: meal.eatenDate,
        eatenTime: meal.eatenTime,
        description: meal.description,
        thumbnailDataUrl: photos.thumbnailDataUrl,
        analysis: result.analysis,
        model: result.model,
        analysisError: result.analysisError,
      });
      return c.json(foodEntrySchema.parse(toFoodEntry(stored)), 201);
    })
    .patch(
      "/entries/:id",
      zValidator("param", idParamSchema),
      zValidator("json", foodEntryUpdateRequestSchema),
      async (c) => {
        const { id } = c.req.valid("param");
        const user = getUser(c);
        const refusal = requireDietAdvice(c, user.dietAdvice);
        if (refusal !== null) {
          return refusal;
        }
        const existing = await entries.findForUser(user.id, id);
        if (existing === null) {
          return notFound(c, "Meal not found");
        }

        const input = c.req.valid("json");
        const meal = resolveMeal(input, {
          eatenAt:
            input.eatenAt === undefined
              ? existing.eatenAt
              : new Date(input.eatenAt),
          storedDescription: existing.description,
          accountTimezone: user.timezone,
        });

        // An edit without a new photo re-analyses the stored thumbnail, because
        // the full-resolution original and the analysis copy are never kept.
        // Removing the photo sends no image at all.
        let thumbnailDataUrl = existing.thumbnailDataUrl;
        let photoDataUrl = existing.thumbnailDataUrl;
        const newPhoto = input.photoDataUrl ?? null;
        if (newPhoto !== null) {
          const photos = await processPhoto(newPhoto);
          if (photos === null) {
            return badRequest(c, UNREADABLE_PHOTO_MESSAGE);
          }
          thumbnailDataUrl = photos.thumbnailDataUrl;
          photoDataUrl = photos.analysisDataUrl;
        } else if (input.removePhoto === true) {
          thumbnailDataUrl = null;
          photoDataUrl = null;
        }

        if (meal.description === null && thumbnailDataUrl === null) {
          return badRequest(c, "Describe the meal or keep a photo.");
        }

        const result = await analyseMeal(
          {
            userId: user.id,
            today: meal.today,
            eatenDate: meal.eatenDate,
            eatenTime: meal.eatenTime,
            description: meal.description,
            photoDataUrl,
            previous: {
              description: existing.description,
              analysis: existing.analysis,
            },
          },
          analysisDeps,
        );

        const stored = await entries.update(user.id, id, {
          eatenAt: meal.eatenAt,
          eatenDate: meal.eatenDate,
          eatenTime: meal.eatenTime,
          description: meal.description,
          thumbnailDataUrl,
          analysis: result.analysis,
          model: result.model,
          analysisError: result.analysisError,
        });
        if (stored === null) {
          return notFound(c, "Meal not found");
        }
        return c.json(foodEntrySchema.parse(toFoodEntry(stored)));
      },
    )
    .get(
      "/entries/:id/photo",
      zValidator("param", idParamSchema),
      async (c) => {
        const { id } = c.req.valid("param");
        const user = getUser(c);
        const dataUrl = await entries.photo(user.id, id);
        if (dataUrl === null) {
          return notFound(c, "Photo not found");
        }
        const photo = decodePhoto(dataUrl);
        if (photo === null) {
          return notFound(c, "Photo not found");
        }
        return new Response(photo.bytes, {
          status: 200,
          headers: {
            "content-type": photo.contentType,
            // A meal's photo can be replaced, so the browser must revalidate.
            // The client adds the entry's updatedAt to the URL for a fresh
            // read.
            "cache-control": "private, no-cache",
          },
        });
      },
    );
}
