import { useEffect, useState } from "react";
import {
  currentUserSchema,
  type CurrentUser,
  type Greeting,
  type Health,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { fetchJson } from "./fetchJson";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { AdminSettingsPage } from "./AdminSettingsPage";
import { CoachDashboard } from "./CoachDashboard";

type Page = "coach" | "admin";

// Absolute API origin for deployed environments (e.g. the Cloud Run URL).
// Empty string keeps relative "/api" for the local Vite dev proxy.
const API_URL = import.meta.env.VITE_API_URL ?? "";

function fetchHealth(): Promise<Health> {
  return fetchJson<Health>(`${API_URL}/api/health`);
}

function fetchGreeting(): Promise<Greeting> {
  return fetchJson<Greeting>(`${API_URL}/api/greet?name=athlete`);
}

export function App() {
  const auth = useAuth();
  const [health, setHealth] = useState<Health | null>(null);
  const [greeting, setGreeting] = useState<Greeting | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [page, setPage] = useState<Page>("coach");
  const [error, setError] = useState<string | null>(null);

  const isAdmin = me?.role === "admin";

  useEffect(() => {
    Promise.all([fetchHealth(), fetchGreeting()])
      .then(([h, g]) => {
        setHealth(h);
        setGreeting(g);
      })
      .catch((e: unknown) => {
        setError(reportError(e));
      });
  }, []);

  // When authenticated, fetch the protected /api/me to prove the token flows.
  useEffect(() => {
    if (!auth.isAuthenticated) {
      setMe(null);
      return;
    }
    fetchJsonAuthed<unknown>(`${API_URL}/api/me`, auth)
      .then((response) => {
        const parsed = currentUserSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error(
            "Loading the current user returned an unexpected response",
            {
              cause: parsed.error,
            },
          );
        }
        setMe(parsed.data);
      })
      .catch((e: unknown) => {
        // TODO: a 401 here (expired token / failed silent renewal) should
        // trigger a re-auth rather than rendering a red "Error". Deferred —
        // see review note #5.
        setError(reportError(e));
      });
    // Depend only on `auth.isAuthenticated`: `useAuth` memoizes `auth`, but the
    // underlying SDK callbacks aren't guaranteed stable, so depending on the
    // whole `auth` object risks re-running this effect (and re-fetching
    // /api/me) on every render.
  }, [auth.isAuthenticated]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Killing It</h1>
      <p className="text-lg opacity-70">Your AI coach for training.</p>

      {error && <p className="text-red-500">Error: {error}</p>}

      {auth.isLoading ? (
        <p className="text-sm opacity-60">Loading…</p>
      ) : auth.isAuthenticated ? (
        <>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <p className="text-sm" data-testid="me">
              Signed in as {me?.sub ?? "…"}
              {isAdmin && (
                <span className="ml-2 rounded border px-2 py-0.5 text-xs">
                  Admin
                </span>
              )}
            </p>
            {isAdmin && (
              <nav className="flex gap-2" aria-label="Sections">
                <button
                  type="button"
                  className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                  onClick={() => setPage("coach")}
                  aria-current={page === "coach" ? "page" : undefined}
                  disabled={page === "coach"}
                >
                  Coach
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                  onClick={() => setPage("admin")}
                  aria-current={page === "admin" ? "page" : undefined}
                  disabled={page === "admin"}
                >
                  Admin settings
                </button>
              </nav>
            )}
            <button
              className="rounded border px-4 py-2"
              onClick={() => void auth.logout()}
            >
              Sign out
            </button>
          </div>

          {isAdmin && page === "admin" ? (
            <AdminSettingsPage />
          ) : (
            <CoachDashboard />
          )}
        </>
      ) : (
        <button
          className="rounded border px-4 py-2"
          onClick={() => void auth.login()}
        >
          Sign in
        </button>
      )}

      {greeting && (
        <p className="text-xl" data-testid="greeting">
          {greeting.message}
        </p>
      )}

      {health && (
        <p className="text-sm opacity-60" data-testid="health">
          {health.service} {health.version} — {health.status}
        </p>
      )}
    </main>
  );
}
