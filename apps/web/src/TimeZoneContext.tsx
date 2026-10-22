import { createContext, useContext, type ReactNode } from "react";
import { browserTimeZone, resolveTimeZone } from "./timeZone";

const TimeZoneContext = createContext<string | null>(null);

/** Supplies the athlete's resolved display zone to the whole app. */
export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string | null;
  children: ReactNode;
}) {
  return (
    <TimeZoneContext.Provider value={resolveTimeZone(timeZone)}>
      {children}
    </TimeZoneContext.Provider>
  );
}

/** The resolved IANA display zone, falling back to the device's zone. */
export function useTimeZone(): string {
  return useContext(TimeZoneContext) ?? browserTimeZone();
}
