import { cadenceUnit, type ActivitySample } from "@killingit/shared";
import { formatDuration } from "./formatDuration";

type NumericChannel =
  | "heartRate"
  | "power"
  | "cadence"
  | "speed"
  | "distance"
  | "elevation"
  | "temperature";

interface SampleChannel {
  key: NumericChannel;
  label: string;
  format: (value: number) => string;
}

/**
 * A collapsible table of the recorded timeseries, so the athlete can inspect
 * what an imported activity actually contains. Only channels that were
 * recorded are shown, and the preview is downsampled by the API.
 */
export function ActivitySamples({
  samples,
  sampleCount,
  activityType,
}: {
  samples: readonly ActivitySample[];
  sampleCount: number;
  activityType: string;
}) {
  const allChannels: SampleChannel[] = [
    { key: "heartRate", label: "HR bpm", format: (v) => `${Math.round(v)}` },
    { key: "power", label: "Power W", format: (v) => `${Math.round(v)}` },
    {
      key: "cadence",
      label: `Cadence ${cadenceUnit(activityType)}`,
      format: (v) => `${Math.round(v)}`,
    },
    { key: "speed", label: "Speed km/h", format: (v) => (v * 3.6).toFixed(1) },
    {
      key: "distance",
      label: "Distance km",
      format: (v) => (v / 1000).toFixed(2),
    },
    {
      key: "elevation",
      label: "Elevation m",
      format: (v) => `${Math.round(v)}`,
    },
    { key: "temperature", label: "Temp °C", format: (v) => v.toFixed(1) },
  ];
  const channels = allChannels.filter((channel) =>
    samples.some((sample) => Number.isFinite(sample[channel.key])),
  );

  const start = Date.parse(samples[0]?.timestamp ?? "");
  const total = Math.max(sampleCount, samples.length);

  return (
    <details
      className="rounded border bg-card text-sm"
      data-testid="activity-samples"
    >
      <summary
        className="cursor-pointer px-2 py-1 text-muted-foreground"
        data-testid="activity-samples-toggle"
      >
        Recorded samples ({samples.length} of {total} shown)
      </summary>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b">
              <th className="px-2 py-1 font-medium">Elapsed</th>
              {channels.map((channel) => (
                <th key={channel.key} className="px-2 py-1 font-medium">
                  {channel.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {samples.map((sample) => {
              const elapsed = Number.isNaN(start)
                ? null
                : Math.max(0, (Date.parse(sample.timestamp) - start) / 1000);
              return (
                <tr key={sample.timestamp} className="border-b last:border-b-0">
                  <td className="px-2 py-1 tabular-nums">
                    {elapsed === null ? "–" : formatDuration(elapsed)}
                  </td>
                  {channels.map((channel) => {
                    const value = sample[channel.key];
                    return (
                      <td key={channel.key} className="px-2 py-1 tabular-nums">
                        {value === undefined ? "–" : channel.format(value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
