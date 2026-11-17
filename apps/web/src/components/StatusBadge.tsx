import type { WeekSessionStatus } from "@killingit/shared";
import { Badge } from "./Badge";

/**
 * A week session's status as a compact badge. The plan and calendar views
 * share it so a status reads the same wherever it appears.
 */
export function StatusBadge({ status }: { status: WeekSessionStatus }) {
  return <Badge className="capitalize">{status}</Badge>;
}
