import type { AnalyzedActivity, CoachPlan, LlmModel } from "@killingit/shared";
import {
  createOpenRouterProvider,
  type LlmMessage,
  type LlmProvider,
} from "../llm/openrouter.js";
import type { CoachingInputs } from "../plans/inputs.js";
import type {
  PlanGenerationStore,
  PlanStore,
  StoredPlan,
} from "../plans/store.js";
import { runPlanGeneration } from "../plans/generate.js";
import type { StoredAthleteQuestion } from "../questions/answers.js";
import type {
  BenchmarkCall,
  BenchmarkModelResult,
  BenchmarkRun,
  BenchmarkStep,
  BenchmarkUsage,
} from "./types.js";

interface InMemoryStores {
  plans: PlanStore;
  generations: PlanGenerationStore;
  current: () => StoredPlan | null;
}

function inMemoryStores(initial: StoredPlan | null): InMemoryStores {
  let stored = initial;
  const plans: PlanStore = {
    load: () => Promise.resolve(stored),
    save: (
      _userId,
      plan,
      answersUpdatedAt,
      coachingInputsUpdatedAt,
      activitiesUpdatedAt,
    ) => {
      stored = {
        plan,
        answersUpdatedAt,
        coachingInputsUpdatedAt,
        activitiesUpdatedAt,
        generatedAt: new Date(),
      };
      return Promise.resolve(stored);
    },
  };
  const generations: PlanGenerationStore = {
    load: () =>
      Promise.resolve({
        status: "idle",
        step: null,
        progress: 0,
        error: null,
        updatedAt: new Date().toISOString(),
      }),
    begin: () => Promise.resolve(true),
    update: () => Promise.resolve(),
    heartbeat: () => Promise.resolve(),
    finish: () => Promise.resolve(),
    fail: () => Promise.resolve(),
  };
  return { plans, generations, current: () => stored };
}

function stepFor(messages: LlmMessage[]): BenchmarkStep {
  const system =
    messages.find((message) => message.role === "system")?.content ?? "";
  if (system.includes("Create a season plan")) return "season";
  if (
    system.includes("Create the first block") ||
    system.includes("Create the next block")
  )
    return "block";
  if (system.includes("Create the week starting")) return "week";
  if (system.includes("Update today's session")) return "day";
  return "unknown";
}

function sumUsage(calls: BenchmarkCall[]): {
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
} {
  let costUsd = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  for (const call of calls) {
    costUsd += call.usage?.cost ?? 0;
    promptTokens += call.usage?.prompt_tokens ?? 0;
    completionTokens += call.usage?.completion_tokens ?? 0;
    reasoningTokens +=
      call.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  }
  return { costUsd, promptTokens, completionTokens, reasoningTokens };
}

interface GenerationInput {
  userId: number;
  apiKey: string;
  model: string;
  today: string;
  force: boolean;
  plan: StoredPlan | null;
  activities: AnalyzedActivity[];
  answers: readonly StoredAthleteQuestion[];
  coachingInputs: CoachingInputs;
  answersUpdatedAt: Date | null;
  coachingInputsUpdatedAt: Date | null;
  activitiesUpdatedAt: Date | null;
}

async function runGeneration(input: GenerationInput): Promise<BenchmarkRun> {
  const calls: BenchmarkCall[] = [];
  const fetchImpl = (async (resource, init) => {
    const url =
      typeof resource === "string"
        ? resource
        : resource instanceof URL
          ? resource.toString()
          : resource.url;
    const requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as {
            messages?: LlmMessage[];
            max_tokens?: number;
            reasoning?: unknown;
          })
        : null;
    const started = performance.now();
    const response = await fetch(resource, init);
    if (!url.includes("/chat/completions") || requestBody === null) {
      return response;
    }

    const clone = response.clone();
    let usage: BenchmarkUsage | null = null;
    let finishReason: string | null = null;
    let contentChars = 0;
    let error: string | null = null;
    try {
      const body = (await clone.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: unknown };
        }>;
        usage?: BenchmarkUsage;
        error?: { message?: string } | string;
      };
      usage = body.usage ?? null;
      finishReason = body.choices?.[0]?.finish_reason ?? null;
      const content = body.choices?.[0]?.message?.content;
      contentChars = typeof content === "string" ? content.length : 0;
      if (typeof body.error === "string") error = body.error;
      else if (body.error && typeof body.error === "object")
        error = body.error.message ?? null;
    } catch (err) {
      error = `could not parse response: ${(err as Error).message}`;
    }

    calls.push({
      step: stepFor(requestBody.messages ?? []),
      repair: (requestBody.messages?.length ?? 0) > 2,
      maxTokens: requestBody.max_tokens ?? 0,
      reasoning: requestBody.reasoning ?? null,
      startedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      httpStatus: response.status,
      finishReason,
      contentChars,
      usage,
      error,
    });
    return response;
  }) as typeof fetch;

  const provider: LlmProvider = createOpenRouterProvider({ fetchImpl });
  const stores = inMemoryStores(input.plan);
  const started = performance.now();
  let plan: CoachPlan | null = null;
  let error: string | null = null;
  try {
    const saved = await runPlanGeneration({
      userId: input.userId,
      today: input.today,
      force: input.force,
      includeTomorrow: false,
      plan: input.plan,
      context: {
        answers: input.answers,
        answersUpdatedAt: input.answersUpdatedAt,
        activities: input.activities,
        manualActivities: input.coachingInputs.manualActivities,
        activityComments: input.coachingInputs.activityComments,
        weeklyNote: input.coachingInputs.weeklyNote,
        periodReviews: input.coachingInputs.periodReviews,
        coachingInputsUpdatedAt: input.coachingInputsUpdatedAt,
        activitiesUpdatedAt: input.activitiesUpdatedAt,
        location: null,
        forecast: null,
        weatherForecasts: null,
        provider,
        apiKey: input.apiKey,
        model: input.model,
      },
      plans: stores.plans,
      generations: stores.generations,
    });
    plan = saved?.plan ?? stores.current()?.plan ?? null;
  } catch (err) {
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  const usage = sumUsage(calls);
  return {
    ok: error === null && plan !== null,
    wallMs: performance.now() - started,
    ...usage,
    calls,
    plan,
    error,
  };
}

export interface BenchmarkRunner {
  pricing: Map<string, LlmModel>;
  runModel(model: string): Promise<BenchmarkModelResult>;
}

/**
 * Runs one model through the app's full build and new-week refresh. The runner
 * is read-only and keeps the plan stores in memory, so benchmark plans never
 * overwrite the athlete's stored plan.
 */
export async function createBenchmarkRunner(input: {
  apiKey: string;
  fixture: import("./fixtures.js").BenchmarkFixture;
  today: string;
  refreshToday: string;
  models: readonly string[];
}): Promise<BenchmarkRunner> {
  const provider = createOpenRouterProvider();
  const listed = await provider.listModels();
  const pricing = new Map(listed.map((model) => [model.id, model]));
  for (const model of input.models) {
    if (!pricing.has(model)) {
      throw new Error(`OpenRouter does not offer model ${model}`);
    }
  }

  return {
    pricing,
    async runModel(model) {
      const pricingModel = pricing.get(model) ?? null;
      let full: BenchmarkRun | null = null;
      let refresh: BenchmarkRun | null = null;
      let error: string | null = null;
      try {
        full = await runGeneration({
          userId: input.fixture.userId,
          apiKey: input.apiKey,
          model,
          today: input.today,
          force: true,
          plan: null,
          activities: input.fixture.activities,
          answers: input.fixture.answers,
          coachingInputs: input.fixture.fullInputs,
          answersUpdatedAt: input.fixture.answersUpdatedAt,
          coachingInputsUpdatedAt: input.fixture.fullInputs.updatedAt,
          activitiesUpdatedAt: input.fixture.activitiesUpdatedAt,
        });

        if (full.ok && full.plan !== null) {
          const stored: StoredPlan = {
            plan: full.plan,
            answersUpdatedAt: input.fixture.answersUpdatedAt,
            coachingInputsUpdatedAt: input.fixture.fullInputs.updatedAt,
            activitiesUpdatedAt: input.fixture.activitiesUpdatedAt,
            generatedAt: new Date(),
          };
          refresh = await runGeneration({
            userId: input.fixture.userId,
            apiKey: input.apiKey,
            model,
            today: input.refreshToday,
            force: false,
            plan: stored,
            activities: input.fixture.activities,
            answers: input.fixture.answers,
            coachingInputs: input.fixture.refreshInputs,
            answersUpdatedAt: input.fixture.answersUpdatedAt,
            coachingInputsUpdatedAt: input.fixture.refreshInputs.updatedAt,
            activitiesUpdatedAt: input.fixture.activitiesUpdatedAt,
          });
        }
      } catch (err) {
        error =
          err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }

      return {
        model,
        pricing:
          pricingModel === null
            ? null
            : {
                promptPricePerMillion: pricingModel.promptPricePerMillion,
                completionPricePerMillion:
                  pricingModel.completionPricePerMillion,
                contextLength: pricingModel.contextLength,
              },
        full,
        refresh,
        error,
      };
    },
  };
}
