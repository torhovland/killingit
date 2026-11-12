import type { WeekSessionStatus } from "@killingit/shared";

/**
 * A week session's status as a compact badge. The plan and calendar views
 * share it so a status reads the same wherever it appears.
 */
export function StatusBadge({ status }: { status: WeekSessionStatus }) {
  return (
    <span className="rounded border bg-muted px-2 py-0.5 text-sm capitalize">
      {status}
    </span>
  );
}
