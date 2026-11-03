/** A warning triangle for destructive actions and danger notices. */
export function DangerIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className={`size-4 shrink-0 ${className}`}
      aria-hidden="true"
      data-testid="danger-icon"
    >
      <path d="M10 3 2.5 16.5h15L10 3Z" strokeLinejoin="round" />
      <path d="M10 7.5v4" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
