import { timeZoneSchema } from "@killingit/shared";

/**
 * Whether `value` is an IANA time zone name the runtime understands. The rule
 * itself lives in the shared `timeZoneSchema` that validates the athlete's
 * setting, so this check cannot drift from the stored contract. See ADR 0055.
 */
export function isValidTimeZone(value: string): boolean {
  return timeZoneSchema.safeParse(value).success;
}
