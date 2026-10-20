import { useEffect, useState } from "react";
import {
  activitiesResponseSchema,
  type Activity,
  type GarminConnectionStatus,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

type SyncState = "idle" | "syncing" | "done" | "error";

/**
 * Garmin connection surface (ADR 0003 amendment): lets the operator enter
 * their Garmin username/password (behind Auth0 sign-in), stores them encrypted
 * via the API, and auto-syncs the last 31 days of activities on load. Shows a
 * syncing progress indicator that will later extend to LLM "thinking" progress.
 */
export function GarminSection() {
  const auth = useAuth();
  const [status, setStatus] = useState<GarminConnectionStatus | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Load status; when connected, auto-sync.
  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    fetchJsonAuthed<GarminConnectionStatus>(
      `${API_URL}/api/garmin/status`,
      auth,
    )
      .then((s) => {
        setStatus(s);
        if (s.connected) {
          return sync(auth);
        }
        return null;
      })
      .catch((e: unknown) => setError(reportError(e)));
  }, [auth.isAuthenticated]);

  async function sync(authState = auth): Promise<void> {
    setSyncState("syncing");
    try {
      const res = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/garmin/activities`,
        authState,
      );
      const parsed = activitiesResponseSchema.safeParse(res);
      if (!parsed.success) {
        throw new Error("Garmin sync returned an unexpected response", {
          cause: parsed.error,
        });
      }
      setActivities(parsed.data.activities);
      setSyncState("done");
    } catch (e: unknown) {
      setSyncState("error");
      setError(reportError(e));
    }
  }

  async function submitCredentials(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const saved = await fetchJsonAuthed<GarminConnectionStatus>(
        `${API_URL}/api/garmin/credentials`,
        auth,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password }),
        },
      );
      setStatus(saved);
      setPassword("");
      await sync(auth);
    } catch (e2: unknown) {
      setError(reportError(e2));
    }
  }

  if (!auth.isAuthenticated) {
    return null;
  }

  if (error) {
    return (
      <section className="text-red-500" data-testid="garmin-error">
        Garmin: {error}
      </section>
    );
  }

  if (!status?.connected) {
    return (
      <section className="flex flex-col items-center gap-2">
        <form
          onSubmit={(e) => void submitCredentials(e)}
          className="flex flex-col gap-2"
          data-testid="garmin-credentials-form"
        >
          <input
            type="text"
            name="username"
            placeholder="Garmin email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="rounded border px-3 py-1"
            autoComplete="username"
          />
          <input
            type="password"
            name="password"
            placeholder="Garmin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border px-3 py-1"
            autoComplete="current-password"
          />
          <button
            type="submit"
            className="rounded border px-4 py-2"
            disabled={!username || !password}
          >
            Connect Garmin
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="flex flex-col items-center gap-2">
      <p className="text-sm text-green-600" data-testid="garmin-status">
        Garmin connected
      </p>
      {syncState === "syncing" && (
        <p className="text-sm opacity-60" data-testid="garmin-syncing">
          Syncing Garmin activities…
        </p>
      )}
      {syncState === "done" &&
        (activities.length === 0 ? (
          <p className="text-sm opacity-60">
            No activities in the last 31 days.
          </p>
        ) : (
          <ul className="text-sm">
            {activities.map((a) => (
              <li key={a.id} data-testid="garmin-activity">
                {a.name} — {a.type} ({Math.round(a.distance)}m)
                {a.samples.length > 0 && (
                  <span className="opacity-60">
                    {" "}
                    · {a.samples.length} samples
                  </span>
                )}
              </li>
            ))}
          </ul>
        ))}
      <button
        className="rounded border px-4 py-2 text-sm"
        onClick={() => void sync(auth)}
        disabled={syncState === "syncing"}
      >
        Sync now
      </button>
    </section>
  );
}
