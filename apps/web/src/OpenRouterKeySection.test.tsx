import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const { SessionExpiredError } = await import("./auth/session");

await mock.module("./auth", () => ({
  SessionExpiredError,
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    getToken: () => Promise.resolve("token"),
  }),
}));

const { OpenRouterKeySection } = await import("./OpenRouterKeySection");

describe("OpenRouterKeySection", () => {
  it("shows the key form with a Save button when no key is stored", () => {
    const html = renderToStaticMarkup(
      <OpenRouterKeySection
        configured={false}
        seasonModel="season/model"
        dailyModel="daily/model"
        onSaved={() => undefined}
      />,
    );

    expect(html).toContain("Connect OpenRouter");
    expect(html).toContain('data-testid="openrouter-key-form"');
    expect(html).toContain("Save");
  });

  it("offers an update action when a key is already stored", () => {
    const html = renderToStaticMarkup(
      <OpenRouterKeySection
        configured={true}
        seasonModel="season/model"
        dailyModel="daily/model"
        onSaved={() => undefined}
      />,
    );

    expect(html).toContain("OpenRouter connected");
    expect(html).toContain("Update OpenRouter API key");
    expect(html).toContain('data-testid="openrouter-edit-key"');
    expect(html).not.toContain('data-testid="openrouter-key-form"');
  });

  it("asks for both models before the first key can be saved", () => {
    const html = renderToStaticMarkup(
      <OpenRouterKeySection
        configured={false}
        seasonModel=""
        dailyModel=""
        onSaved={() => undefined}
      />,
    );

    expect(html).toContain("Choose a season and day-to-day model below");
    expect(html).toContain("disabled");
  });
});
