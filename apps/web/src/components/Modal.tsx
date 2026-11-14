import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./cn";
import { trappedFocusIndex } from "./modalFocus";

/** The elements a Tab press can reach inside an open dialog. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface ModalProps {
  /** The id of the heading inside the dialog that names it. */
  labelledBy: string;
  /** The id of the element that describes the dialog, when it has one. */
  describedBy?: string;
  /** Closes the dialog from Escape or a backdrop click. */
  onClose: () => void;
  /** Panel layout such as width or scrolling; the surface stays the default. */
  className?: string;
  testId?: string;
  children: ReactNode;
}

/**
 * A modal dialog with the keyboard behaviour a modal needs: focus moves in on
 * open, Tab and Shift+Tab wrap inside it, Escape or a backdrop click closes
 * it, and the element that opened it gets focus back when it closes. Mount it
 * only while it is open.
 */
export function Modal({
  labelledBy,
  describedBy,
  onClose,
  className,
  testId,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusables = (): HTMLElement[] =>
      panel === null
        ? []
        : Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const inside = (element: Element | null): element is HTMLElement =>
      panel !== null &&
      element instanceof HTMLElement &&
      panel.contains(element);

    const first = focusables()[0];
    (first ?? panel)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || panel === null) {
        return;
      }
      const elements = focusables();
      const active = document.activeElement;
      const activeIndex = inside(active) ? elements.indexOf(active) : -1;
      const targetIndex = trappedFocusIndex(
        elements.length,
        activeIndex,
        event.shiftKey,
      );
      if (targetIndex === null) {
        return;
      }
      event.preventDefault();
      if (targetIndex === -1) {
        panel.focus();
      } else {
        elements[targetIndex]?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (trigger?.isConnected) {
        trigger.focus();
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      {/*
        The backdrop is a real button rather than a div with a click handler:
        it is the dialog's pointer-only close affordance (Escape is the
        keyboard one), and a button keeps it reachable to assistive tech
        instead of leaving an unlabelled click target.
      */}
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-background/80"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn(
          "relative w-full rounded-lg border bg-card p-4 shadow-lg outline-none",
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}
