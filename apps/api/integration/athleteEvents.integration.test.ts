import "./setup.js";
import { describe, expect, it } from "bun:test";
import type { AthleteEvent } from "@killingit/shared";
import {
  eventKey,
  loadAthleteEvents,
  replaceAthleteEvents,
} from "../src/events/store.js";
import { dbUserStore } from "../src/users/store.js";
import { countRows } from "./database.js";
import { postgresErrorCode } from "./helpers.js";
import { setupIntegrationSuite } from "./setup.js";

setupIntegrationSuite();

const MARATHON: AthleteEvent = {
  startDate: "2027-03-14",
  endDate: null,
  title: "Oslo Marathon",
  kind: "race",
};

const ALPS_TRIP: AthleteEvent = {
  startDate: "2027-07-01",
  endDate: "2027-07-14",
  title: "Alps trip",
  kind: "trip",
};

const DISTANCE_GOAL: AthleteEvent = {
  startDate: "2026-12-01",
  endDate: null,
  title: "Cover 100 km in December",
  kind: "goal",
};

describe("athlete events", () => {
  it("replaces the stored list instead of appending to it", async () => {
    const user = await dbUserStore.ensureUser("auth0|events-replace");

    await replaceAthleteEvents(user.id, [MARATHON, ALPS_TRIP]);
    expect(await loadAthleteEvents(user.id)).toEqual([MARATHON, ALPS_TRIP]);

    // The reading is authoritative: an event edited out of the athlete's text
    // disappears rather than staying beside the new one.
    await replaceAthleteEvents(user.id, [DISTANCE_GOAL]);
    expect(await loadAthleteEvents(user.id)).toEqual([DISTANCE_GOAL]);
    expect(await countRows("athlete_events")).toBe(1);
  });

  it("stores one row for events that share an identity", async () => {
    const user = await dbUserStore.ensureUser("auth0|events-dedup");
    const renamedKind: AthleteEvent = { ...MARATHON, kind: "event" };
    expect(eventKey(renamedKind)).toBe(eventKey(MARATHON));

    await replaceAthleteEvents(user.id, [MARATHON, renamedKind, DISTANCE_GOAL]);

    // The first event with a key wins, so the duplicate's kind does not replace
    // the stored one.
    expect(await loadAthleteEvents(user.id)).toEqual([DISTANCE_GOAL, MARATHON]);
    expect(await countRows("athlete_events")).toBe(2);
  });

  it("loads every event earliest first and keeps both end dates", async () => {
    const user = await dbUserStore.ensureUser("auth0|events-order");

    await replaceAthleteEvents(user.id, [ALPS_TRIP, MARATHON, DISTANCE_GOAL]);

    expect(await loadAthleteEvents(user.id)).toEqual([
      DISTANCE_GOAL,
      MARATHON,
      ALPS_TRIP,
    ]);
  });

  it("clears the stored events when the replacement list is empty", async () => {
    const user = await dbUserStore.ensureUser("auth0|events-clear");

    await replaceAthleteEvents(user.id, [MARATHON, ALPS_TRIP]);
    await replaceAthleteEvents(user.id, []);

    expect(await loadAthleteEvents(user.id)).toEqual([]);
    expect(await countRows("athlete_events")).toBe(0);
  });

  it("replaces only the account's own events", async () => {
    const owner = await dbUserStore.ensureUser("auth0|events-scope-owner");
    const other = await dbUserStore.ensureUser("auth0|events-scope-other");

    await replaceAthleteEvents(owner.id, [MARATHON]);
    await replaceAthleteEvents(other.id, [ALPS_TRIP]);
    await replaceAthleteEvents(owner.id, [DISTANCE_GOAL]);

    expect(await loadAthleteEvents(owner.id)).toEqual([DISTANCE_GOAL]);
    expect(await loadAthleteEvents(other.id)).toEqual([ALPS_TRIP]);
    expect(await countRows("athlete_events")).toBe(2);
  });

  it("keeps the previous list when a replacement fails a stored constraint", async () => {
    const user = await dbUserStore.ensureUser("auth0|events-rollback");
    await replaceAthleteEvents(user.id, [MARATHON]);

    let code: string | undefined;
    try {
      await replaceAthleteEvents(user.id, [
        DISTANCE_GOAL,
        {
          startDate: "2027-05-01",
          endDate: "2027-04-01",
          title: "Impossible dates",
          kind: "event",
        },
      ]);
    } catch (error) {
      code = postgresErrorCode(error);
    }

    // The delete and the insert share a transaction, so the failed replacement
    // leaves the athlete's previous events in place.
    expect(code).toBe("23514");
    expect(await loadAthleteEvents(user.id)).toEqual([MARATHON]);
    expect(await countRows("athlete_events")).toBe(1);
  });

  it("removes every event when the account is deleted", async () => {
    const owner = await dbUserStore.ensureUser("auth0|events-cascade-owner");
    const other = await dbUserStore.ensureUser("auth0|events-cascade-other");
    await replaceAthleteEvents(owner.id, [MARATHON, ALPS_TRIP]);
    await replaceAthleteEvents(other.id, [DISTANCE_GOAL]);

    await dbUserStore.deleteUser(owner.sub);

    expect(await loadAthleteEvents(owner.id)).toEqual([]);
    expect(await loadAthleteEvents(other.id)).toEqual([DISTANCE_GOAL]);
    expect(await countRows("athlete_events")).toBe(1);
  });
});
