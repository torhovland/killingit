import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";

const SOURCE_DIR = import.meta.dir;

/**
 * The modules allowed directly at the web source root. ADR 0059 keeps the
 * cross-page pieces here — the app shell and entry point, providers and
 * contexts, routing and authentication, shared hooks, shared rendering helpers
 * and the API, date, PWA and error utilities — and gives every page or feature
 * its own directory. Adding a root module is a deliberate exception to review
 * as such; a module that belongs to a feature goes in that feature's directory
 * instead.
 */
const ROOT_MODULES = new Set([
  // App shell and entry point.
  "App.tsx",
  "AppBody.tsx",
  "AppHeader.tsx",
  "AppStatus.tsx",
  "ErrorBoundary.tsx",
  "ErrorPage.tsx",
  "instrument.ts",
  "main.tsx",
  "navigation.tsx",
  "PageOutlet.tsx",
  "PwaBanners.tsx",
  "pwaBuild.ts",
  "PwaContext.tsx",
  "PwaInstall.tsx",
  "UserMenu.tsx",
  // Providers, routing and authentication.
  "AthleteQuestionsProvider.tsx",
  "CurrentUserProvider.tsx",
  "SignInPage.tsx",
  "surveyGate.ts",
  "TimeZoneContext.tsx",
  "useRouteGuards.ts",
  // Shared hooks.
  "useApiResource.ts",
  "useAthleteQuestions.ts",
  "useCommentForm.ts",
  "useModelCatalogRefresh.ts",
  "usePropDraft.ts",
  "useStatuses.ts",
  "useTimeZoneState.ts",
  "useToday.ts",
  // Shared rendering helpers.
  "Bullet.tsx",
  "CalorieBalancePanel.tsx",
  "CommentSection.tsx",
  "DangerIcon.tsx",
  "FormattedText.tsx",
  "SessionSetting.tsx",
  "Spinner.tsx",
  "SubmitButton.tsx",
  "TrainingLoadLine.tsx",
  "WeatherIcon.tsx",
  "WeatherSummary.tsx",
  // API, date, browser and error utilities.
  "apiUrl.ts",
  "apiVersion.ts",
  "dateFormat.ts",
  "download.ts",
  "fetchAuthed.ts",
  "fetchJson.ts",
  "formatDistance.ts",
  "formColors.ts",
  "imageUpload.ts",
  "mapProjection.ts",
  "reportError.ts",
  "requestAbort.ts",
  "timeZone.ts",
  // Test and type setup.
  "testSetup.ts",
  "vite-env.d.ts",
]);

/** A source module directly at the web source root, without its tests. */
function rootSourceModules(): string[] {
  return readdirSync(SOURCE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        (name.endsWith(".ts") || name.endsWith(".tsx")) &&
        !name.endsWith(".test.ts") &&
        !name.endsWith(".test.tsx"),
    );
}

describe("web source root", () => {
  it("holds only the shared plumbing ADR 0059 keeps at the root", () => {
    const unexpected = rootSourceModules()
      .filter((file) => !ROOT_MODULES.has(file))
      .map(
        (file) =>
          `${file} is a new root module; ADR 0059 puts a feature's modules in its feature directory`,
      );

    expect(unexpected).toEqual([]);
  });

  it("lists every root module that exists", () => {
    const present = new Set(rootSourceModules());
    const stale = [...ROOT_MODULES].filter((file) => !present.has(file));

    expect(stale).toEqual([]);
  });
});
