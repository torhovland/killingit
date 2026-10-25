/**
 * An indeterminate loading spinner. Inside a submit button, omit `label` so the
 * button's own text stays the accessible name.
 */
export function Spinner({
  label,
  className = "size-4",
}: {
  /** Accessible label for a standalone spinner. */
  label?: string;
  /** Tailwind size and colour utilities. */
  className?: string;
}) {
  const classes = `inline-flex animate-spin rounded-full border-2 border-current border-t-transparent ${className}`;

  if (label) {
    return (
      <span
        className={classes}
        role="status"
        aria-label={label}
        title={label}
        data-testid="spinner"
      />
    );
  }

  return <span className={classes} aria-hidden="true" data-testid="spinner" />;
}
