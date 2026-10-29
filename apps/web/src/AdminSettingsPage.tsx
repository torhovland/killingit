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
  return (
    <section
      className="flex w-full flex-col gap-6 text-left"
      data-testid="admin-settings"
    >
      <h2 className="text-2xl font-semibold">Admin settings</h2>

      <DevDatePicker />
      <AdminQuestionsSection />
      <AdminLlmCallsSection />
      <AdminModelRemarksSection />
    </section>
  );
}
