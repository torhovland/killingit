import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { usePropDraft } from "./usePropDraft";

interface Value {
  count: number;
}

function isEqual(left: Value, right: Value): boolean {
  return left.count === right.count;
}

describe("usePropDraft", () => {
  it("keeps an edit until the source holds a genuinely new value", () => {
    const { result, rerender } = renderHook(
      ({ source }: { source: Value }) => usePropDraft(source, isEqual),
      { initialProps: { source: { count: 1 } } },
    );
    expect(result.current.value.count).toBe(1);

    act(() => result.current.update({ count: 2 }));
    expect(result.current.value.count).toBe(2);

    // The same value in a new object is still the base of the edit.
    rerender({ source: { count: 1 } });
    expect(result.current.value.count).toBe(2);

    // A real change to the source replaces the edit.
    rerender({ source: { count: 3 } });
    expect(result.current.value.count).toBe(3);
  });
});
