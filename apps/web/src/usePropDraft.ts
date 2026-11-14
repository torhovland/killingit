import { useState } from "react";

export interface PropDraft<T> {
  /** The value to show: the local edit while its base is still the source. */
  value: T;
  /** Records a local edit made on top of the current source value. */
  update: (next: T) => void;
}

/**
 * Keeps a form value derived from a prop. The prop stays the source of truth
 * while the athlete has not edited it; an edit then survives a parent re-render
 * as long as the prop still holds the value the edit was based on, and a
 * genuinely new prop value wins. No effect copies the prop into state, so a
 * re-render with an equal value neither discards the draft nor adds a render.
 * See `docs/specs/web-form-drafts.md` and ADR 0046.
 */
export function usePropDraft<T>(
  source: T,
  isEqual: (left: T, right: T) => boolean,
): PropDraft<T> {
  const [edit, setEdit] = useState<{ base: T; value: T } | null>(null);
  const keepsEdit = edit !== null && isEqual(edit.base, source);
  return {
    value: keepsEdit ? edit.value : source,
    update: (next: T) => setEdit({ base: source, value: next }),
  };
}
