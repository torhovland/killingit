import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./cn";

/** The classes of the button that opens the menu. */
const TRIGGER_CLASS =
  "flex items-center gap-2 rounded border bg-card px-2 py-1.5 text-base hover:bg-muted";

/** The classes of the navigation panel the items sit in. */
const PANEL_CLASS =
  "absolute right-0 z-10 mt-1 flex min-w-48 flex-col rounded border bg-card p-1 text-base shadow-lg";

export interface MenuProps {
  /** The accessible name of the trigger button. */
  label: string;
  /** The accessible name of the navigation landmark around the items. */
  panelLabel: string;
  /** Whether the panel is shown; the caller owns the state. */
  open: boolean;
  /** Opens or closes the panel from the trigger, Escape or an outside click. */
  onOpenChange: (open: boolean) => void;
  /** The trigger's contents, such as an avatar and the account name. */
  trigger: ReactNode;
  /** Root layout such as `ml-auto`; the trigger and panel keep their look. */
  className?: string;
  testId?: string;
  children: ReactNode;
}

/**
 * A disclosure button around a labelled navigation menu. The caller owns the
 * open state and marks its current item with `aria-current="page"`. Escape and
 * a click outside close the panel, and focus returns to the trigger when an
 * item inside it loses the panel, so the keyboard path never lands on the
 * body. Mount the panel only while `open`, like `Modal`.
 */
export function Menu({
  label,
  panelLabel,
  open,
  onOpenChange,
  trigger,
  className,
  testId,
  children,
}: MenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    const trigger = triggerRef.current;

    const handlePointerDown = (event: MouseEvent) => {
      if (root === null || !(event.target instanceof Node)) return;
      if (!root.contains(event.target)) {
        onOpenChangeRef.current(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChangeRef.current(false);
      trigger?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      if (panel !== null && panel.contains(document.activeElement)) {
        trigger?.focus();
      }
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      data-testid={testId}
    >
      <button
        ref={triggerRef}
        type="button"
        className={TRIGGER_CLASS}
        aria-label={label}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {trigger}
      </button>
      {open && (
        <nav ref={panelRef} aria-label={panelLabel} className={PANEL_CLASS}>
          {children}
        </nav>
      )}
    </div>
  );
}
