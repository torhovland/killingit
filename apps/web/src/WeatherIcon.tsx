import {
  WEATHER_ICON_LABELS,
  type WeatherIcon as WeatherIconKind,
} from "@killingit/shared";

/**
 * A small inline icon for the five forecast categories. Kept as SVG so the
 * plan does not depend on an icon package or emoji font. The sun and
 * precipitation use their own colors while clouds stay neutral.
 */
export function WeatherIcon({
  icon,
  className = "size-5",
}: {
  icon: WeatherIconKind;
  className?: string;
}) {
  const label = WEATHER_ICON_LABELS[icon];
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      {icon === "sun" && (
        <g className="stroke-amber-500">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </g>
      )}
      {icon === "partly_cloudy" && (
        <>
          <g className="stroke-amber-500">
            <circle cx="8.5" cy="8.5" r="3" />
            <path d="M8.5 3.5v1M3.5 8.5h1M5 5.5l.7.7M12 5.5l-.7.7M5 11.5l.7-.7" />
          </g>
          <g className="stroke-slate-400">
            <path d="M7 18h10a3 3 0 0 0 .4-5.97A5 5 0 0 0 8 13a2.5 2.5 0 0 0-1 5Z" />
          </g>
        </>
      )}
      {icon === "very_cloudy" && (
        <g className="stroke-slate-400">
          <path d="M6 18h11a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.6 1.1A3.2 3.2 0 0 0 6 18Z" />
        </g>
      )}
      {icon === "rain" && (
        <>
          <g className="stroke-slate-400">
            <path d="M6 14h11a3.5 3.5 0 0 0 .3-7A5.5 5.5 0 0 0 6.7 8.1 3.2 3.2 0 0 0 6 14Z" />
          </g>
          <g className="stroke-sky-500">
            <path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2" />
          </g>
        </>
      )}
      {icon === "snow" && (
        <>
          <g className="stroke-slate-400">
            <path d="M6 14h11a3.5 3.5 0 0 0 .3-7A5.5 5.5 0 0 0 6.7 8.1 3.2 3.2 0 0 0 6 14Z" />
          </g>
          <g className="stroke-sky-300">
            <path d="M8 18v3M6.7 18.8l2.6 1.4M9.3 18.8l-2.6 1.4M16 18v3M14.7 18.8l2.6 1.4M17.3 18.8l-2.6 1.4" />
          </g>
        </>
      )}
    </svg>
  );
}
