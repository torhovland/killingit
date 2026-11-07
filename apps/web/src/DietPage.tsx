import { useEffect, useState } from "react";
import { foodEntriesResponseSchema, type FoodEntry } from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { FoodEntryCard } from "./FoodEntryCard";
import { fetchJsonAuthed } from "./fetchAuthed";
import { useNavigate } from "./navigation";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Every meal the athlete has logged, newest first, with the coach's analysis and
 * a thumbnail when a photo was attached.
 */
export function DietPage({ dietAdvice }: { dietAdvice: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { setStatus } = useAppStatus();
  const [entries, setEntries] = useState<FoodEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus("diet-page", loading ? "loading" : null);
    return () => setStatus("diet-page", null);
  }, [loading, setStatus]);

  async function loadEntries(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/diet/entries`,
        auth,
      );
      const parsed = foodEntriesResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error("Loading your meals returned an unexpected response", {
          cause: parsed.error,
        });
      }
      setEntries(parsed.data.entries);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (auth.isAuthenticated) {
      void loadEntries();
    }
    // Only re-run when sign-in flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  return (
    <section className="flex flex-col gap-4 text-left" data-testid="diet-page">
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-semibold">Diet</h2>
        <p className="text-base text-muted-foreground">
          Every meal you have logged and your coach's reading of it.
        </p>
      </div>

      {!dietAdvice && (
        <p className="rounded border bg-inset p-3 text-base">
          Diet advice is off. Turn it on in Settings to log meals and see them
          here.{" "}
          <button
            type="button"
            className="underline hover:no-underline"
            onClick={() => navigate("settings")}
          >
            Open Settings
          </button>
        </p>
      )}

      {error && <p className="text-destructive">Error: {error}</p>}

      {error !== null && entries === null && !loading ? (
        <button
          type="button"
          className="self-start rounded border bg-card px-4 py-2 enabled:hover:bg-muted"
          onClick={() => void loadEntries()}
        >
          Retry
        </button>
      ) : loading && entries === null ? (
        <p className="text-base text-muted-foreground">Loading your meals…</p>
      ) : entries !== null && entries.length === 0 ? (
        <p className="text-base text-muted-foreground">
          No meals have been logged yet. Use the food log on the Coach page to
          add one.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {entries?.map((entry) => (
            <FoodEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}
