import { useEffect, useState } from "react";
import type { Greeting, Health } from "@killingit/shared";
import { fetchJson } from "./fetchJson";
import { reportError } from "./reportError";

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
  const [health, setHealth] = useState<Health | null>(null);
  const [greeting, setGreeting] = useState<Greeting | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchHealth(), fetchGreeting()])
      .then(([h, g]) => {
        setHealth(h);
        setGreeting(g);
      })
      .catch((e: unknown) => {
        // Show the error in the UI and report it to Sentry via reportError.
        setError(reportError(e));
      });
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Killing It</h1>
      <p className="text-lg opacity-70">Your AI coach for training.</p>

      {error && <p className="text-red-500">Error: {error}</p>}

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
