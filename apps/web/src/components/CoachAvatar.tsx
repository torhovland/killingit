import { useId } from "react";
import { cn } from "./cn";

/**
 * The coach's avatar: a small illustrated head wearing a slightly rotated cap,
 * drawn in the brand palette. It is decorative, so the quote it sits beside
 * carries the content for assistive technology.
 */
export function CoachAvatar({ className }: { className?: string }) {
  const clipId = `coach-avatar-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      className={cn("size-10 shrink-0", className)}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="24" cy="24" r="24" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <circle cx="24" cy="24" r="24" className="fill-accent/25" />
        <path d="M9 48c1-8 6.8-13 15-13s14 5 15 13z" className="fill-primary" />
        <rect
          x="20"
          y="27"
          width="8"
          height="9"
          rx="4"
          className="fill-foreground"
        />
        <ellipse
          cx="24"
          cy="22"
          rx="9.5"
          ry="10.5"
          className="fill-foreground"
        />
        <circle cx="14.8" cy="23" r="1.8" className="fill-foreground" />
        <circle cx="33.2" cy="23" r="1.8" className="fill-foreground" />
        <g transform="rotate(-9 24 14)">
          <path
            d="M14.5 15.5C14.5 9.2 18.7 5 24 5s9.5 4.2 9.5 10.5z"
            className="fill-primary"
          />
          <path
            d="M13 15.5h22c1.4 0 2.5.9 2.5 2s-1.1 2-2.5 2H13c-1.4 0-2.5-.9-2.5-2s1.1-2 2.5-2z"
            className="fill-accent"
          />
          <circle
            cx="24"
            cy="5.8"
            r="1.1"
            className="fill-primary-foreground"
          />
        </g>
        <circle cx="20.3" cy="22.3" r="1.2" className="fill-background" />
        <circle cx="27.7" cy="22.3" r="1.2" className="fill-background" />
        <path
          d="M20.5 26.2c1.1 1.3 2.3 2 3.5 2s2.4-.7 3.5-2"
          fill="none"
          className="stroke-background"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
