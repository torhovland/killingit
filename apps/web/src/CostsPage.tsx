import { useEffect, useState } from "react";
import {
  llmCostsResponseSchema,
  type LlmCostsResponse,
} from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { CostBarChart } from "./CostBarChart";
import {
  DAILY_COST_RANGES,
  DAILY_COST_RANGE_LABELS,
  dailyCostChart,
  monthlyCostChart,
  MONTHLY_COST_RANGES,
  MONTHLY_COST_RANGE_LABELS,
  COST_STACK_DIMENSIONS,
  COST_STACK_DIMENSION_LABELS,
  type CostStackDimension,
  type DailyCostRange,
  type MonthlyCostRange,
} from "./costChart";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { useTimeZone } from "./TimeZoneContext";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * The AI costs page: what the athlete's coach prompts cost on OpenRouter, per
 * month and per day, stacked by the model that answered or by prompt type.
 */
export function CostsPage() {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const timeZone = useTimeZone();
  const today = getToday(timeZone).today;
  const [costs, setCosts] = useState<LlmCostsResponse | null>(null);
  const [monthlyRange, setMonthlyRange] = useState<MonthlyCostRange>("12m");
  const [dailyRange, setDailyRange] = useState<DailyCostRange>("31d");
  const [stackBy, setStackBy] = useState<CostStackDimension>("model");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const stackLabel = stackBy === "model" ? "model" : "prompt type";

  useEffect(() => {
    setStatus("costs-page", loading ? "loading" : null);
    return () => setStatus("costs-page", null);
  }, [loading, setStatus]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJsonAuthed<unknown>(`${API_URL}/api/llm/costs`, auth)
      .then((response) => {
        const parsed = llmCostsResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error("The cost history returned an unexpected response", {
            cause: parsed.error,
          });
        }
        if (!cancelled) {
          setCosts(parsed.data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(reportError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // `auth` is consumed inside and is not guaranteed to be referentially
    // stable, so only the sign-in state re-runs the fetch.
  }, [auth.isAuthenticated]);

  if (!auth.isAuthenticated) {
    return null;
  }

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">AI costs</h2>
        <p className="text-base text-muted-foreground">
          What your coach&apos;s OpenRouter prompts cost, split by the model
          that answered or the type of prompt.
        </p>
      </div>

      {error && <p className="text-destructive">Error: {error}</p>}

      {costs === null ? (
        !error && <p className="text-base text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-end gap-4 text-base">
            {loading && (
              <span className="text-muted-foreground" aria-live="polite">
                Updating…
              </span>
            )}
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Stack by</span>
              <select
                className="rounded border bg-card px-2 py-1"
                value={stackBy}
                aria-label="Stack cost bars by"
                onChange={(event) =>
                  setStackBy(event.target.value as CostStackDimension)
                }
              >
                {COST_STACK_DIMENSIONS.map((dimension) => (
                  <option key={dimension} value={dimension}>
                    {COST_STACK_DIMENSION_LABELS[dimension]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 text-base">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Show</span>
              <select
                className="rounded border bg-card px-2 py-1"
                value={monthlyRange}
                aria-label="Monthly cost range"
                onChange={(event) =>
                  setMonthlyRange(event.target.value as MonthlyCostRange)
                }
              >
                {MONTHLY_COST_RANGES.map((range) => (
                  <option key={range} value={range}>
                    {MONTHLY_COST_RANGE_LABELS[range]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <CostBarChart
            title="Monthly cost"
            description={`One bar per month, stacked by ${stackLabel}.`}
            data={monthlyCostChart(costs.monthly, monthlyRange, today, stackBy)}
            emptyMessage="No OpenRouter calls have been recorded in this period."
            testId="monthly-cost-chart"
          />

          <div className="flex items-center justify-end gap-2 text-base">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Show</span>
              <select
                className="rounded border bg-card px-2 py-1"
                value={dailyRange}
                aria-label="Daily cost range"
                onChange={(event) =>
                  setDailyRange(event.target.value as DailyCostRange)
                }
              >
                {DAILY_COST_RANGES.map((range) => (
                  <option key={range} value={range}>
                    {DAILY_COST_RANGE_LABELS[range]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <CostBarChart
            title="Daily cost"
            description={`One bar per day, stacked by ${stackLabel}.`}
            data={dailyCostChart(costs.daily, dailyRange, today, stackBy)}
            emptyMessage="No OpenRouter calls have been recorded in this period."
            testId="daily-cost-chart"
          />
        </>
      )}
    </section>
  );
}
