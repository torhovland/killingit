import { AdminQuestionsSection } from "./AdminQuestionsSection";
import { AdminLlmCallsSection } from "./AdminLlmCallsSection";
import { DevDatePicker } from "./DevDatePicker";

/**
 * Admin-only configuration surface. Visibility here is convenience; the API
 * enforces the admin role on every admin route (ADR 0006).
 */
export function AdminSettingsPage() {
  return (
    <section
      className="flex w-full max-w-3xl flex-col gap-6 text-left"
      data-testid="admin-settings"
    >
      <h2 className="text-2xl font-semibold">Admin settings</h2>

      <AdminQuestionsSection />
      <AdminLlmCallsSection />
      <DevDatePicker />
    </section>
  );
}
