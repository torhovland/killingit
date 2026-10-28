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
      className="flex w-full max-w-5xl flex-col gap-6 text-left"
      data-testid="admin-settings"
    >
      <h2 className="text-2xl font-semibold">Admin settings</h2>

      {/* The prompt log needs the wider container for its list/detail split;
          the other sections keep a narrower reading measure. */}
      <div className="max-w-3xl">
        <AdminQuestionsSection />
      </div>
      <AdminLlmCallsSection />
      <div className="max-w-3xl">
        <DevDatePicker />
      </div>
    </section>
  );
}
