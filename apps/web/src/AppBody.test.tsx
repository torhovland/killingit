import { afterAll, describe, expect, it, mock } from "bun:test";
import type { AthleteQuestionsResponse } from "@killingit/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthState } from "./auth";
import type { Page } from "./navigation";
import type { SurveyGate } from "./surveyGate";

/** The app body only reads the session's sign-in state through its providers. */
const SIGNED_OUT: AuthState = {
  isAuthenticated: false,
  isLoading: false,
  sub: null,
  firstName: null,
  picture: null,
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve(undefined),
};

const { SessionExpiredError } = await import("./auth/session");

await mock.module("./auth", () => ({
  SessionExpiredError,
  useAuth: () => SIGNED_OUT,
}));

// The route guards have their own suite; here the page outlet and the survey
// only need to show that the body mounted them.
await mock.module("./PageOutlet", () => ({
  PageOutlet: ({ page }: { page: Page }) => (
    <p data-testid="page-outlet">{page}</p>
  ),
}));

await mock.module("./coach/CoachingSurveyPage", () => ({
  CoachingSurveyPage: ({ onAnswersSaved }: { onAnswersSaved: () => void }) => (
    <button type="button" data-testid="survey-stub" onClick={onAnswersSaved}>
      Survey
    </button>
  ),
}));

const { AppBody } = await import("./AppBody");
const { AppStatusProvider } = await import("./AppStatus");
const { CurrentUserProvider } = await import("./CurrentUserProvider");

afterAll(() => {
  mock.restore();
});

const COMPLETE: AthleteQuestionsResponse = { questions: [], complete: true };

interface BodyOptions {
  signedIn?: boolean;
  authLoading?: boolean;
  questions?: AthleteQuestionsResponse | null;
  questionsLoading?: boolean;
  questionsError?: string | null;
  gate?: SurveyGate;
  page?: Page;
  isAdmin?: boolean;
}

function renderBody(options: BodyOptions = {}) {
  const onSignIn = mock<() => void>();
  const onRetryQuestions = mock<() => void>();
  const onAnswersSaved = mock<() => void>();
  const onTimeZoneChanged = mock<(timeZone: string | null) => void>();
  render(
    <AppStatusProvider>
      <CurrentUserProvider>
        <AppBody
          signedIn={options.signedIn ?? true}
          authLoading={options.authLoading ?? false}
          onSignIn={onSignIn}
          questions={
            options.questions === undefined ? COMPLETE : options.questions
          }
          questionsLoading={options.questionsLoading ?? false}
          questionsError={options.questionsError ?? null}
          onRetryQuestions={onRetryQuestions}
          gate={options.gate ?? "page"}
          page={options.page ?? "coach"}
          isAdmin={options.isAdmin ?? false}
          planRefreshKey={0}
          timeZone={null}
          onAnswersSaved={onAnswersSaved}
          onTimeZoneChanged={onTimeZoneChanged}
        />
      </CurrentUserProvider>
    </AppStatusProvider>,
  );
  return { onSignIn, onRetryQuestions, onAnswersSaved, onTimeZoneChanged };
}

/** The classes of the content panel, which carries the page's width. */
function panelClasses(): DOMTokenList {
  return screen.getByTestId("app-panel").classList;
}

describe("AppBody", () => {
  it("shows the landing page to a signed-out visitor", async () => {
    const { onSignIn } = renderBody({ signedIn: false });
    const user = userEvent.setup();

    expect(screen.getByTestId("sign-in-page")).toBeDefined();
    expect(panelClasses().contains("max-w-5xl")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("waits for the session before choosing the landing page", () => {
    renderBody({ signedIn: false, authLoading: true });

    expect(screen.getByText("Loading…")).toBeDefined();
    expect(screen.queryByTestId("sign-in-page")).toBeNull();
  });

  it("waits for the athlete's profile", () => {
    renderBody({ questions: null, questionsLoading: true });

    expect(screen.getByText("Loading your profile…")).toBeDefined();
  });

  it("offers a retry when the profile fails to load", async () => {
    const { onRetryQuestions } = renderBody({
      questions: null,
      questionsError: "The questions could not be loaded",
    });
    const user = userEvent.setup();

    expect(screen.getByText(/could not be loaded/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetryQuestions).toHaveBeenCalledTimes(1);
  });

  it("renders the survey while the gate holds the athlete", async () => {
    const { onAnswersSaved } = renderBody({ gate: "survey" });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("survey-stub"));

    expect(onAnswersSaved).toHaveBeenCalledTimes(1);
  });

  it("waits on the admin page until the account's role is known", () => {
    renderBody({ gate: "wait", page: "admin", isAdmin: false });

    expect(screen.getByText("Loading…")).toBeDefined();
    expect(screen.queryByTestId("page-outlet")).toBeNull();
  });

  it("renders the page the gate opened", async () => {
    renderBody({ gate: "page", page: "calendar" });

    expect((await screen.findByTestId("page-outlet")).textContent).toBe(
      "calendar",
    );
    expect(panelClasses().contains("max-w-7xl")).toBe(true);
  });

  it("keeps the survey's narrow panel when the gate replaces a calendar visit", async () => {
    renderBody({ gate: "survey", page: "calendar" });

    await waitFor(() =>
      expect(screen.getByTestId("survey-stub")).toBeDefined(),
    );
    expect(panelClasses().contains("max-w-5xl")).toBe(true);
  });

  it("renders the coach page in place of the admin page for a member", async () => {
    renderBody({ gate: "page", page: "admin", isAdmin: false });

    expect((await screen.findByTestId("page-outlet")).textContent).toBe(
      "coach",
    );
  });
});
