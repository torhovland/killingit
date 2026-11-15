import { AdminQuestionsSection } from "./AdminQuestionsSection";
import { AdminLlmCallsSection } from "./AdminLlmCallsSection";
import { AdminModelRemarksSection } from "./AdminModelRemarksSection";
import { DevDatePicker } from "./DevDatePicker";

/**
 * Admin-only configuration surface. Visibility here is convenience; the API
 * enforces the admin role on every admin route (ADR 0006). The development
 * tools come first because they are what an admin reaches for while testing.
 */
export function AdminSettingsPage() {
  // The build-time twin of `isDateOverrideAllowed()`: Vite replaces these env
  // reads with literals, so a Production build folds the flag to `false` and
  // the bundler drops `DevDatePicker` instead of shipping code that only
  // renders null. A dev server and the deployed Test build both keep the
  // picker.
  const devToolsBundled =
    import.meta.env.DEV ||
    import.meta.env.VITE_APP_ENV === "Development" ||
    import.meta.env.VITE_APP_ENV === "Test";

  return (
    <section
      className="flex w-full flex-col gap-6 text-left"
      data-testid="admin-settings"
    >
      <h2 className="text-3xl font-semibold">Admin settings</h2>

      {devToolsBundled && <DevDatePicker />}
      <AdminQuestionsSection />
      <AdminLlmCallsSection />
      <AdminModelRemarksSection />
    </section>
  );
}
