import { useEffect, useRef, useState } from "react";

/** The display zone the shell shows, and the setter a saved zone uses. */
export interface TimeZoneState {
  /** The zone on screen; null follows the device zone. */
  timeZone: string | null;
  /** Stores a zone the athlete just saved, keeping it through a late load. */
  setTimeZone: (timeZone: string | null) => void;
}

export interface TimeZoneStateOptions {
  /** Whether the athlete is signed in. */
  signedIn: boolean;
  /** The saved account zone, or null/undefined before the account loads. */
  accountTimeZone: string | null | undefined;
}

/**
 * The display zone shown across the app. It starts from the saved account
 * setting. The touched ref lets a zone the athlete just saved survive a late
 * account load; signing out clears both so the next account starts from its own
 * setting.
 */
export function useTimeZoneState({
  signedIn,
  accountTimeZone,
}: TimeZoneStateOptions): TimeZoneState {
  const [timeZone, setTimeZoneState] = useState<string | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    if (!signedIn) {
      setTimeZoneState(null);
      touched.current = false;
      return;
    }
    if (!touched.current) {
      setTimeZoneState(accountTimeZone ?? null);
    }
  }, [signedIn, accountTimeZone]);

  function setTimeZone(next: string | null): void {
    touched.current = true;
    setTimeZoneState(next);
  }

  return { timeZone, setTimeZone };
}
