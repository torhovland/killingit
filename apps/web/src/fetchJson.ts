import * as Sentry from "@sentry/react";

// Fetches a URL and parses it as JSON, recording a Sentry breadcrumb for the
// request and throwing an Error that carries enough context (URL, status,
// content type) to make the resulting Sentry event actionable even when the
// underlying failure has no stack trace of its own (e.g. Response.json()'s
// native SyntaxError).
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const method = init?.method ?? "GET";
  const res = await fetch(url, init);
  const status = res.status;
  const contentType = res.headers.get("content-type") ?? "unknown";

  Sentry.addBreadcrumb({
    category: "http",
    level: res.ok ? "info" : "error",
    message: `${method} ${url}`,
    data: { url, method, status, content_type: contentType },
  });

  const text = await res.text();

  if (!res.ok) {
    // Surface the server's short text detail (e.g. "invalid OpenRouter API
    // key") so configuration forms can show a useful message instead of only
    // the status code.
    const detail = text.trim();
    throw new Error(
      `${method} ${url} failed: ${status} (${contentType})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new Error(
      `${method} ${url} returned invalid JSON (status ${status}, ${contentType})`,
      { cause },
    );
  }
}
