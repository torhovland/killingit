import { expect, test, type Page } from "@playwright/test";

/** Port the e2e API process listens on (see `apps/api/e2e/config.ts`). */
const API_URL = "http://127.0.0.1:3101";
/** The reply and macros the stub coach returns. */
const COACH_REPLY =
  "Good work. Keep the rest of the week steady and save something for the weekend.";
const FOOD_ANALYSIS_CALORIES = "385 kcal";
/** A valid 1x1 PNG; the API derives the thumbnail with Jimp. */
const MEAL_PHOTO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3J4wAAAABJRU5ErkJggg==";

interface SeedOptions {
  questions?: "none" | "unanswered" | "answered";
  plan?: boolean;
  dietAdvice?: boolean;
}

async function seed(page: Page, options: SeedOptions): Promise<string> {
  const response = await page.request.post(`${API_URL}/e2e/seed`, {
    data: options,
  });
  expect(response.ok()).toBe(true);
  const state = (await response.json()) as { today: string };
  return state.today;
}

/** Seeds the requested state, opens the app and signs in through the landing page. */
async function signIn(page: Page, options: SeedOptions): Promise<void> {
  const today = await seed(page, options);
  await page.addInitScript((date) => {
    localStorage.setItem("killingit.dev.today-override", date);
  }, today);
  await page.goto("/");
  await expect(page.getByTestId("sign-in-page")).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("user-menu")).toBeVisible();
}

async function openPage(page: Page, label: string): Promise<void> {
  await page.getByTestId("user-menu").locator("summary").click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

test("a visitor signs in from the landing page and lands on the dashboard", async ({
  page,
}) => {
  await signIn(page, { questions: "answered" });

  await expect(page.getByTestId("coaching-inputs")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
});

test("an athlete answers the survey and sees today's session", async ({
  page,
}) => {
  await signIn(page, { questions: "unanswered", plan: true });

  await expect(page.getByTestId("coaching-survey-page")).toBeVisible();
  await page
    .getByTestId("athlete-profile")
    .locator("textarea")
    .first()
    .fill("A fast autumn sportive, with time to recover.");
  await page.getByRole("button", { name: "Save answer" }).click();
  await expect(page.getByTestId("athlete-profile")).toContainText(
    "Answered questions",
  );

  // A reload lands on the dashboard now that every question is answered.
  await page.reload();
  await expect(page.getByTestId("plan-today")).toContainText("Today's session");
});

test("an athlete saves a weekly note and sees the coach reply", async ({
  page,
}) => {
  const noteLoaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/coaching/weekly/notes") &&
      response.request().method() === "GET",
  );
  const noteInput = page.locator("#weekly-note");
  await signIn(page, { questions: "answered", plan: true });
  await noteLoaded;
  // The note load fills the textarea when it settles, so type only once the
  // dashboard's requests are quiet.
  await page.waitForLoadState("networkidle");

  await noteInput.fill("I can only train three times next week.");
  await expect(noteInput).toHaveValue(
    "I can only train three times next week.",
  );
  await page.getByRole("button", { name: "Send to coach" }).click();

  await expect(page.getByTestId("weekly-note-reply")).toContainText(
    COACH_REPLY,
  );
});

test("an athlete logs a meal with a photo and sees the analysis", async ({
  page,
}) => {
  await signIn(page, { questions: "answered", dietAdvice: true });

  await expect(page.getByTestId("food-log")).toBeVisible();
  await page
    .getByPlaceholder("e.g. Two slices of wholegrain toast")
    .fill("Porridge with a banana");
  await page.getByTestId("meal-photo-upload").setInputFiles({
    name: "meal.png",
    mimeType: "image/png",
    buffer: Buffer.from(MEAL_PHOTO_BASE64, "base64"),
  });
  await expect(page.getByAltText("The meal photo you attached")).toBeVisible();
  await page.getByRole("button", { name: "Log meal" }).click();

  await expect(page.getByTestId("food-entry")).toBeVisible();
  await expect(page.getByTestId("food-entry")).toContainText(
    FOOD_ANALYSIS_CALORIES,
  );
  await expect(page.getByTestId("food-diet-fit")).toContainText(
    "fits the training load",
  );
});

test("a keyboard user closes the calendar workout dialog and gets focus back", async ({
  page,
}) => {
  await signIn(page, { questions: "answered", plan: true });

  await openPage(page, "Calendar");
  const chip = page.getByTestId("calendar-session").first();
  await chip.click();
  const dialog = page.getByTestId("calendar-entry-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(chip).toBeFocused();
});

test("a keyboard user stays in the open delete dialog and gets focus back", async ({
  page,
}) => {
  await signIn(page, { questions: "answered" });

  await openPage(page, "Settings");
  const trigger = page.getByTestId("delete-account-button");
  await trigger.click();
  const dialog = page.getByTestId("delete-account-dialog");
  await expect(dialog).toBeVisible();

  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const confirm = page.getByTestId("delete-account-confirm");
  await expect(cancel).toBeFocused();

  // Shift+Tab from the first control and Tab from the last both wrap inside.
  await page.keyboard.press("Shift+Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("an athlete deletes the account and lands back on the sign-in page", async ({
  page,
}) => {
  await signIn(page, { questions: "answered" });

  await openPage(page, "Settings");
  await expect(page.getByTestId("delete-account-section")).toBeVisible();
  await page.getByTestId("delete-account-button").click();
  await expect(page.getByTestId("delete-account-dialog")).toBeVisible();
  await page.getByTestId("delete-account-confirm").click();

  await expect(page.getByTestId("sign-in-page")).toBeVisible();
});
