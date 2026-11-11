import { useState } from "react";
import {
  garminConnectionStatusSchema,
  type GarminConnectionStatus,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { Button } from "./components/Button";
import { Input } from "./components/Input";

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
  const [editing, setEditing] = useState(!connected);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitCredentials(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const parsed = await requestParsed(
        `${API_URL}/api/garmin/credentials`,
        auth,
        garminConnectionStatusSchema,
        "Connecting to Garmin",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password }),
        },
      );
      setPassword("");
      setEditing(false);
      onConnected(parsed);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!auth.isAuthenticated) {
    return null;
  }

  if (connected && !editing) {
    return (
      <section className="flex flex-col gap-1" data-testid="garmin-status">
        <p className="text-base text-success">Garmin connected</p>
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="self-start"
          onClick={() => setEditing(true)}
          data-testid="garmin-edit-credentials"
        >
          Update Garmin credentials
        </Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-2xl font-semibold">
        {connected ? "Update Garmin credentials" : "Connect Garmin"}
      </h2>
      {error && (
        <p className="text-destructive" data-testid="garmin-error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => void submitCredentials(e)}
        className="flex flex-col gap-2"
        data-testid="garmin-credentials-form"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="text"
            name="username"
            placeholder="Garmin email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            size="line"
            autoComplete="username"
          />
          <Input
            type="password"
            name="password"
            placeholder="Garmin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            size="line"
            autoComplete="current-password"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={saving || !username || !password}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          {connected && (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => {
                setUsername("");
                setPassword("");
                setError(null);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
