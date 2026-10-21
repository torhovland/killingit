import { useState } from "react";
import {
  garminConnectionStatusSchema,
  type GarminConnectionStatus,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface GarminSectionProps {
  connected: boolean;
  onConnected: (status: GarminConnectionStatus) => void;
}

/**
 * Garmin credential entry (ADR 0003 amendment). Credentials are validated by
 * the API before being stored encrypted and are never sent back to the client.
 * Activity sync and display live in the coaching dashboard.
 */
export function GarminSection({ connected, onConnected }: GarminSectionProps) {
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitCredentials(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/garmin/credentials`,
        auth,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password }),
        },
      );
      const parsed = garminConnectionStatusSchema.safeParse(res);
      if (!parsed.success) {
        throw new Error("Garmin connect returned an unexpected response", {
          cause: parsed.error,
        });
      }
      setPassword("");
      onConnected(parsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!auth.isAuthenticated) {
    return null;
  }

  if (connected) {
    return (
      <p className="text-sm text-success" data-testid="garmin-status">
        Garmin connected
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">Connect Garmin</h2>
      {error && (
        <p className="text-destructive" data-testid="garmin-error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => void submitCredentials(e)}
        className="flex flex-col gap-2 sm:flex-row"
        data-testid="garmin-credentials-form"
      >
        <input
          type="text"
          name="username"
          placeholder="Garmin email"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="rounded border bg-card px-3 py-1"
          autoComplete="username"
        />
        <input
          type="password"
          name="password"
          placeholder="Garmin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border bg-card px-3 py-1"
          autoComplete="current-password"
        />
        <button
          type="submit"
          className="rounded border border-transparent bg-primary px-4 py-2 text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
          disabled={saving || !username || !password}
        >
          {saving ? "Connecting…" : "Connect Garmin"}
        </button>
      </form>
    </section>
  );
}
