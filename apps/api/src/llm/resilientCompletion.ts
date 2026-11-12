import type { LlmPromptKind } from "@killingit/shared";
import {
  isLlmAbortError,
  LlmAbortError,
  LlmProviderError,
  LlmTokenLimitError,
  type LlmMessage,
  type LlmProvider,
  type LlmReasoning,
} from "./openrouter.js";
import {
  COMPLETION_BUDGET_MS,
  MAX_COMPLETION_ATTEMPTS,
  MAX_COMPLETION_TOKENS,
  RESCUE_COMPLETION_TOKENS,
} from "./planBudget.js";

export interface CompletionCredentials {
  apiKey: string;
  model: string;
  /** Cancels the completion when a newer coach run starts. */
  signal?: AbortSignal;
}

/**
 * The attempts and wall-clock time one coach call may still spend. A plan level
 * shares one budget across its fallback chain and JSON repair turns, so a model
 * that keeps failing cannot restart the chain with a fresh allowance.
 */
export interface CompletionBudget {
  /** Provider attempts still permitted. */
  attemptsRemaining: number;
  /** Epoch milliseconds after which no attempt starts or continues. */
  deadline: number;
}

export interface CompletionBudgetOptions {
  /** Overrides `MAX_COMPLETION_ATTEMPTS`, for a caller that shares a budget. */
  attempts?: number;
  /** Overrides `COMPLETION_BUDGET_MS`. */
  budgetMs?: number;
}

/** Creates a fresh budget, starting the wall clock now. */
export function createCompletionBudget(
  options: CompletionBudgetOptions = {},
): CompletionBudget {
  return {
    attemptsRemaining: options.attempts ?? MAX_COMPLETION_ATTEMPTS,
    deadline: Date.now() + (options.budgetMs ?? COMPLETION_BUDGET_MS),
  };
}

/** True while the budget still allows another provider attempt. */
export function completionBudgetLeft(budget: CompletionBudget): boolean {
  return budget.attemptsRemaining > 0 && Date.now() < budget.deadline;
}

/** The coaching task and extra metadata recorded in the prompt log. */
export interface CompletionOptions {
  kind?: LlmPromptKind;
  metadata?: Record<string, unknown>;
  /** Shared retry and time budget; a fresh one is created when omitted. */
  budget?: CompletionBudget;
}

interface CompletionAttempt {
  maxTokens: number;
  reasoning?: LlmReasoning;
}

const ATTEMPTS_MESSAGE =
  "The coach model kept failing without a usable answer; try again, or choose a different model in Settings.";
const TIMEOUT_MESSAGE =
  "The coach model ran out of time before it finished; try again, or choose a faster model in Settings.";

/**
 * Sends a text completion with fallbacks for reasoning models. Attempts are
 * ordered from the least intrusive to the most forceful:
 *
 * 1. the requested budget with minimal reasoning;
 * 2. the requested budget with reasoning disabled;
 * 3. a doubled budget without reasoning control;
 * 4. a small budget without reasoning control, for models that reject a large
 *    `max_tokens`.
 *
 * Reasoning tokens count against `maxTokens`, so a model can exhaust the budget
 * before it writes any visible text. Retrying with less reasoning or a larger
 * budget avoids surfacing a truncated response as a hard failure. The small
 * budget is only added when the caller asks for more than 4,096 tokens; it
 * keeps models with a low output ceiling usable after a 400 rejection.
 *
 * Only a truncated response and a 400 rejection are retried: every other
 * provider error (invalid key, no credits, unknown model, rate limit, transport
 * failure) ends the call immediately. The attempt and wall-clock caps, shared
 * budget and benchmark evidence for the ladder live in
 * `docs/specs/llm-completion-budget.md`.
 */
export async function completeWithFallbacks(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  messages: LlmMessage[],
  maxTokens: number,
  temperature = 0.4,
  options: CompletionOptions = {},
): Promise<string> {
  const budget = options.budget ?? createCompletionBudget();
  const attempts = attemptLadder(maxTokens);
  const ofAttempts = Math.min(attempts.length, budget.attemptsRemaining);

  let lastError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    // A cancelled run must not spend another completion attempt.
    if (isAborted(credentials.signal)) {
      throw new LlmAbortError();
    }
    if (budget.attemptsRemaining <= 0) {
      throw spentBudget(ATTEMPTS_MESSAGE, lastError);
    }
    const remainingMs = budget.deadline - Date.now();
    if (remainingMs <= 0) {
      throw spentBudget(TIMEOUT_MESSAGE, lastError);
    }
    budget.attemptsRemaining -= 1;

    try {
      return await provider.complete({
        apiKey: credentials.apiKey,
        model: credentials.model,
        messages,
        temperature,
        maxTokens: attempt.maxTokens,
        ...(attempt.reasoning !== undefined
          ? { reasoning: attempt.reasoning }
          : {}),
        ...(options.kind !== undefined ? { kind: options.kind } : {}),
        // The deadline aborts an attempt that would outlive the budget, so a
        // slow model cannot stretch one call past its wall-clock allowance.
        signal:
          credentials.signal === undefined
            ? AbortSignal.timeout(remainingMs)
            : AbortSignal.any([
                credentials.signal,
                AbortSignal.timeout(remainingMs),
              ]),
        metadata: {
          ...(options.metadata ?? {}),
          attempt: index + 1,
          ofAttempts,
        },
      });
    } catch (err) {
      lastError = err;

      if (isLlmAbortError(err)) {
        // The run was cancelled, or the provider's own request timeout fired.
        if (isAborted(credentials.signal) || Date.now() < budget.deadline) {
          throw err instanceof LlmAbortError
            ? err
            : new LlmAbortError(undefined, { cause: err });
        }
        throw spentBudget(TIMEOUT_MESSAGE, err);
      }
      // A larger budget or reduced reasoning may fit the same response.
      if (err instanceof LlmTokenLimitError) {
        continue;
      }
      // Some models reject an unsupported reasoning control or an oversized
      // max_tokens with a 400; try the next fallback before giving up.
      if (
        index < attempts.length - 1 &&
        err instanceof LlmProviderError &&
        err.status === 400
      ) {
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * The fallback configurations in the order they are tried. A provider that
 * accepts the reasoning control and the budget normally succeeds on the first
 * one; each later attempt spends a call the athlete pays for.
 */
function attemptLadder(maxTokens: number): CompletionAttempt[] {
  const doubled = Math.min(maxTokens * 2, MAX_COMPLETION_TOKENS);
  const ladder: CompletionAttempt[] = [
    { maxTokens, reasoning: { effort: "minimal" } },
    { maxTokens, reasoning: { effort: "none" } },
    { maxTokens: doubled },
  ];
  if (maxTokens > RESCUE_COMPLETION_TOKENS) {
    ladder.push({ maxTokens: RESCUE_COMPLETION_TOKENS });
  }
  return ladder;
}

/** Wraps the last provider error in the sentence the athlete should read. */
function spentBudget(message: string, cause: unknown): LlmProviderError {
  return new LlmProviderError(
    message,
    undefined,
    cause === undefined ? undefined : { cause },
  );
}

/** True when the caller has already cancelled the run. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
