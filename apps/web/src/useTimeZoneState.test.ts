import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import {
  useTimeZoneState,
  type TimeZoneStateOptions,
} from "./useTimeZoneState";

/** Mounts the hook with a signed-in account whose saved zone can change. */
function renderZone(initialProps: TimeZoneStateOptions) {
  return renderHook((props: TimeZoneStateOptions) => useTimeZoneState(props), {
    initialProps,
  });
}

describe("useTimeZoneState", () => {
  it("starts from the saved account zone", () => {
    const { result, rerender } = renderZone({
      signedIn: true,
      accountTimeZone: null,
    });
    expect(result.current.timeZone).toBeNull();

    rerender({ signedIn: true, accountTimeZone: "Europe/Oslo" });

    expect(result.current.timeZone).toBe("Europe/Oslo");
  });

  it("keeps a zone the athlete just saved through a late account load", () => {
    const { result, rerender } = renderZone({
      signedIn: true,
      accountTimeZone: null,
    });

    act(() => result.current.setTimeZone("Asia/Tokyo"));
    expect(result.current.timeZone).toBe("Asia/Tokyo");

    // The account request settles after the save with the older stored zone.
    rerender({ signedIn: true, accountTimeZone: "Europe/Oslo" });

    expect(result.current.timeZone).toBe("Asia/Tokyo");
  });

  it("clears the zone on sign-out so the next account starts from its own", () => {
    const { result, rerender } = renderZone({
      signedIn: true,
      accountTimeZone: "Europe/Oslo",
    });
    act(() => result.current.setTimeZone("Asia/Tokyo"));

    rerender({ signedIn: false, accountTimeZone: null });
    expect(result.current.timeZone).toBeNull();

    rerender({ signedIn: true, accountTimeZone: "Europe/Berlin" });

    expect(result.current.timeZone).toBe("Europe/Berlin");
  });
});
