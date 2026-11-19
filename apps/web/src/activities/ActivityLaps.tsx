import {
  activityUsesPace,
  cadenceUnit,
  formatActivityPaceOrSpeed,
  formatDuration,
  paceUnitLabel,
  type ActivityLap,
} from "@killingit/shared";

/** One table column, rendered only when at least one lap has the value. */
interface LapColumn {
  key: string;
  label: string;
  value: (lap: ActivityLap) => string | null;
}

/**
 * A collapsible table of the recorded laps and their averages, so the athlete
 * can see how each interval or auto-lap went. Columns that were not recorded on
 * any lap are omitted, matching the recorded-samples table.
 */
export function ActivityLaps({
  laps,
  activityType,
}: {
  laps: readonly ActivityLap[];
  activityType: string;
}) {
  const pace = activityUsesPace(activityType);
  const definitions: LapColumn[] = [
    {
      key: "time",
      label: "Time",
      value: (lap) => {
        const duration = lap.movingTime ?? lap.elapsedTime;
        return duration === undefined ? null : formatDuration(duration);
      },
    },
    {
      key: "distance",
      label: "Distance km",
      value: (lap) =>
        lap.distance !== undefined && lap.distance > 0
          ? (lap.distance / 1000).toFixed(2)
          : null,
    },
    {
      key: "speed",
      label: pace ? `Pace ${paceUnitLabel(activityType)}` : "Speed km/h",
      value: (lap) =>
        lap.averageSpeed === undefined || lap.averageSpeed <= 0
          ? null
          : formatActivityPaceOrSpeed(activityType, lap.averageSpeed),
    },
    {
      key: "averagePower",
      label: "Avg power W",
      value: (lap) =>
        lap.averagePower === undefined
          ? null
          : `${Math.round(lap.averagePower)}`,
    },
    {
      key: "maxPower",
      label: "Max power W",
      value: (lap) =>
        lap.maxPower === undefined ? null : `${Math.round(lap.maxPower)}`,
    },
    {
      key: "averageHeartRate",
      label: "Avg HR bpm",
      value: (lap) =>
        lap.averageHeartRate === undefined
          ? null
          : `${Math.round(lap.averageHeartRate)}`,
    },
    {
      key: "maxHeartRate",
      label: "Max HR bpm",
      value: (lap) =>
        lap.maxHeartRate === undefined
          ? null
          : `${Math.round(lap.maxHeartRate)}`,
    },
    {
      key: "averageCadence",
      label: `Cadence ${cadenceUnit(activityType)}`,
      value: (lap) =>
        lap.averageCadence === undefined
          ? null
          : `${Math.round(lap.averageCadence)}`,
    },
    {
      key: "elevation",
      label: "Elevation m",
      value: (lap) =>
        lap.totalElevationGain !== undefined && lap.totalElevationGain > 0
          ? `${Math.round(lap.totalElevationGain)}`
          : null,
    },
  ];
  const columns = definitions.filter((column) =>
    laps.some((lap) => column.value(lap) !== null),
  );

  return (
    <details
      className="rounded border bg-inset text-base"
      data-testid="activity-laps"
    >
      <summary
        className="cursor-pointer px-2 py-1 text-muted-foreground"
        data-testid="activity-laps-toggle"
      >
        Recorded laps ({laps.length})
      </summary>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-inset">
            <tr className="border-b">
              <th className="px-2 py-1 font-medium">Lap</th>
              {columns.map((column) => (
                <th key={column.key} className="px-2 py-1 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => (
              <tr key={lap.index} className="border-b last:border-b-0">
                <td className="px-2 py-1 tabular-nums">
                  {lap.index}
                  {lap.type === undefined ? "" : ` (${lap.type})`}
                </td>
                {columns.map((column) => (
                  <td key={column.key} className="px-2 py-1 tabular-nums">
                    {column.value(lap) ?? "–"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
