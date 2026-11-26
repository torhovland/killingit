import { useId } from "react";
import { cn } from "./cn";

/**
 * The coach's portrait: a detailed illustrated head and shoulders wearing a
 * slightly rotated cap, drawn in the brand palette. The quote names the image
 * "Your coach", so the illustration carries who is speaking; the decorative
 * quote mark beside it stays hidden from assistive technology.
 *
 * The brand surfaces and the cap use design tokens. The skin, hair, beard and
 * cap-shading tones are illustration colours rather than UI colours, so they
 * are kept locally with the artwork.
 */
export function CoachAvatar({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const backgroundId = `coach-avatar-background-${id}`;
  const clipId = `coach-avatar-clip-${id}`;
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Your coach"
      className={cn("shrink-0 rounded-full", className)}
    >
      <defs>
        <linearGradient id={backgroundId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--palette-steel)" />
          <stop offset="1" stopColor="var(--palette-cobalt)" />
        </linearGradient>
        <clipPath id={clipId}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <rect width="64" height="64" fill={`url(#${backgroundId})`} />
        <circle
          cx="52"
          cy="8"
          r="18"
          fill="var(--palette-periwinkle)"
          opacity=".14"
        />

        {/* Sweater and collar */}
        <path d="M5 66C6 53 17 47 32 47s26 6 27 19z" fill="#16226E" />
        <path
          d="M9 61Q32 44 55 61"
          fill="none"
          stroke="var(--palette-white)"
          strokeWidth="5"
        />
        <path
          d="M9 61Q32 44 55 61"
          fill="none"
          stroke="#16226E"
          strokeWidth="2.2"
          strokeDasharray="1.6 2.4"
        />
        <path
          d="M8 66Q32 49 56 66"
          fill="none"
          stroke="#FF8A7A"
          strokeWidth="1.4"
        />

        {/* Neck */}
        <rect x="27" y="42" width="10" height="8" rx="3" fill="#E6B897" />
        <path
          d="M26 48.5Q32 52.5 38 48.5"
          fill="none"
          stroke="var(--palette-white)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Ears and face */}
        <circle cx="20.6" cy="33" r="2.6" fill="#EFC3A4" />
        <circle cx="43.4" cy="33" r="2.6" fill="#EFC3A4" />
        <ellipse cx="32" cy="32" rx="11.5" ry="12.5" fill="#F3CFB3" />

        {/* Hair under the cap */}
        <path
          d="M39.5 23.5c4.5 0 6.2 4.2 5 8.8-1-2.8-2.6-4-5-4.4z"
          fill="#E8C06A"
        />

        {/* Brows, eyes, nose and cheeks */}
        <path
          d="M25.6 29.8q2.3-1.2 4.6 0M33.8 29.4q2.3-1.2 4.6 0"
          fill="none"
          stroke="#C4913F"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="27.9" cy="32.9" r="1.6" fill="#3D74E0" />
        <circle cx="36.1" cy="32.9" r="1.6" fill="#3D74E0" />
        <circle cx="27.9" cy="33" r=".75" fill="#121A55" />
        <circle cx="36.1" cy="33" r=".75" fill="#121A55" />
        <circle cx="28.4" cy="32.4" r=".4" fill="var(--palette-white)" />
        <circle cx="36.6" cy="32.4" r=".4" fill="var(--palette-white)" />
        <path
          d="M32 33.6q1.6 2.4-.4 3"
          fill="none"
          stroke="#D99C7A"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <circle cx="25" cy="36.6" r="1.6" fill="#FF8A7A" opacity=".4" />
        <circle cx="39" cy="36.6" r="1.6" fill="#FF8A7A" opacity=".4" />

        {/* Beard and moustache */}
        <path
          d="M20.6 32c0 10 4.4 15.5 11.4 15.5S43.4 42 43.4 32c-.9 5-3.4 7.5-6.9 8-1.5-1.4-2.9-1.8-4.5-1.8s-3 .4-4.5 1.8c-3.5-.5-6-3-6.9-8z"
          fill="#D9A24F"
        />
        <path
          d="M27 40.4c1.6-1.2 3.2-1.6 5-1.6s3.4.4 5 1.6"
          fill="none"
          stroke="#B98236"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M29.6 42.4q2.4 1.7 4.8 0"
          fill="none"
          stroke="#7A4E1E"
          strokeWidth="1.3"
          strokeLinecap="round"
        />

        {/* Slanted cap */}
        <g transform="rotate(-12 32 28)">
          <path
            d="M19.5 27.5C19.5 17.5 25 13 32 13s12.5 4.5 12.5 14.5z"
            fill="var(--palette-lime)"
          />
          <path
            d="M32 13c3.6 1.6 6 6.6 6.4 14.5h6.1C44.5 17.5 39 13 32 13z"
            fill="#C9E23A"
          />
          <path
            d="M32 13.4v14M25.6 15.6q-1.6 5.4-1.2 11.9"
            fill="none"
            stroke="var(--palette-cobalt)"
            strokeOpacity=".22"
            strokeWidth=".8"
          />
          <path
            d="M19.5 27.5h25"
            stroke="var(--palette-cobalt)"
            strokeOpacity=".3"
            strokeWidth="1.2"
          />
          <circle cx="32" cy="13.4" r="1.4" fill="var(--palette-cobalt)" />
          <path
            d="M24.5 26.4C17.5 25.6 10.5 26.8 8.6 29.8c4.6 1.3 11 .4 16.6-1.6z"
            fill="#B5CC2C"
          />
        </g>
      </g>

      <circle
        cx="32"
        cy="32"
        r="31"
        fill="none"
        stroke="var(--palette-lime)"
        strokeOpacity=".6"
        strokeWidth="2"
      />
    </svg>
  );
}
