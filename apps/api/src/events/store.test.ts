import { describe, expect, it } from "bun:test";
import type { AthleteEvent } from "@killingit/shared";
import { eventKey } from "./store.js";

describe("eventKey", () => {
  const race: AthleteEvent = {
    startDate: "2027-03-14",
    endDate: null,
    title: "Oslo Marathon",
    kind: "race",
  };

  it("is the same for an event and a copy of it", () => {
    expect(eventKey(race)).toBe(eventKey({ ...race }));
  });

  it("separates events that differ in a stored field", () => {
    const copies = [
      race,
      { ...race, startDate: "2027-03-15" },
      { ...race, endDate: "2027-03-16" },
      { ...race, title: "Bergen Marathon" },
    ];
    expect(new Set(copies.map(eventKey)).size).toBe(copies.length);
  });
});
