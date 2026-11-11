import { API_CONTRACT_VERSION, API_VERSION_HEADER } from "@killingit/shared";

/** The session-storage key that stops a version mismatch reloading in a loop. */
export const OUTDATED_RELOAD_MARKER = "killingit.api-outdated-reload";

/** A reload for the same mismatch is repeated at most once a minute. */
const OUTDATED_RELOAD_COOLDOWN_MS = 60 * 1000;

/** Adds the contract version the API expects to an outgoing request. */
export function withApiVersion(headers: Headers): Headers {
  headers.set(API_VERSION_HEADER, String(API_CONTRACT_VERSION));
  return headers;
}

type Listener = () => void;

const listeners = new Set<Listener>();

/** Reports that the API refused this app build's contract version. */
export function reportApiOutdated(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribes to version mismatches; returns the unsubscribe function. */
export function subscribeApiOutdated(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Claims the one automatic reload allowed in a cooldown window. Returns true
 * only for the first mismatch, so a mismatch a reload cannot fix shows the
 * update notice instead of reloading forever.
 */
export function claimOutdatedReload(
  storage: Pick<Storage, "getItem" | "setItem">,
  now = Date.now(),
): boolean {
  try {
    const previous = Number(storage.getItem(OUTDATED_RELOAD_MARKER));
    if (now - previous < OUTDATED_RELOAD_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(OUTDATED_RELOAD_MARKER, String(now));
    return true;
  } catch {
    // Storage can be unavailable (for example in a locked-down private mode).
    // Show the notice rather than risk a reload loop we cannot count.
    return false;
  }
}
