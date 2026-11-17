import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

/** The row of tabs above the selected panel. */
const TABLIST_CLASS = "flex flex-wrap gap-1";

/** A tab's look; the selected one takes the primary surface. */
const TAB_CLASS =
  "rounded border bg-inset px-3 py-1 text-base aria-[selected=true]:border-transparent aria-[selected=true]:bg-primary aria-[selected=true]:text-primary-foreground";

export interface TabEntry<Id extends string = string> {
  /** The tab's identifier, also used in its tab and panel ids. */
  id: Id;
  /** The tab's visible label, which also names its panel. */
  label: ReactNode;
  /** The panel shown while this tab is selected. */
  content: ReactNode;
}

export interface TabsProps<Id extends string = string> {
  /** The accessible name of the tablist. */
  label: string;
  /** The tabs in reading order; only the selected tab's panel is mounted. */
  tabs: ReadonlyArray<TabEntry<Id>>;
  /** The selected tab's id; the caller owns the state. */
  value: Id;
  /** Selects a tab from a click, ArrowLeft/ArrowRight, Home or End. */
  onChange: (id: Id) => void;
  /** Root layout; the tablist and panel keep their look. */
  className?: string;
  testId?: string;
}

/**
 * A WAI-ARIA horizontal tablist and the panel of the selected tab. The caller
 * owns the selection; a click or an arrow key reports the new id through
 * `onChange`, and arrow keys also move focus, wrapping at either end. Each tab
 * names the panel it controls, and only that panel is mounted.
 */
export function Tabs<Id extends string>({
  label,
  tabs,
  value,
  onChange,
  className,
  testId,
}: TabsProps<Id>) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = tabs.find((entry) => entry.id === value);
  const tabId = (id: Id) => `${baseId}-tab-${id}`;
  const panelId = (id: Id) => `${baseId}-panel-${id}`;

  const handleKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    const last = tabs.length - 1;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
        nextIndex = index === 0 ? last : index - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = last;
        break;
      default:
        return;
    }
    const next = tabs[nextIndex];
    if (next === undefined) return;
    event.preventDefault();
    onChange(next.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={cn(className)} data-testid={testId}>
      <div className={TABLIST_CLASS} role="tablist" aria-label={label}>
        {tabs.map((entry, index) => (
          <button
            key={entry.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={tabId(entry.id)}
            aria-controls={panelId(entry.id)}
            aria-selected={entry.id === value}
            tabIndex={entry.id === value ? 0 : -1}
            className={TAB_CLASS}
            onClick={() => onChange(entry.id)}
            onKeyDown={(event) => handleKeyDown(index, event)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {selected !== undefined && (
        <div
          key={selected.id}
          role="tabpanel"
          id={panelId(selected.id)}
          aria-labelledby={tabId(selected.id)}
        >
          {selected.content}
        </div>
      )}
    </div>
  );
}
