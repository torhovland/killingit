import "./setup.js";
import { describe, expect, it } from "bun:test";
import { db } from "../src/db/index.js";
import { manualActivities } from "../src/db/schema.js";
import {
  loadManualActivities,
  saveManualActivity,
  updateManualActivity,
  updateManualActivityTss,
} from "../src/plans/inputs.js";
import { dbUserStore } from "../src/users/store.js";
import { postgresErrorCode } from "./helpers.js";
import { setupIntegrationSuite } from "./setup.js";

setupIntegrationSuite();

describe("manual activity writes", () => {
  it("updates the athlete's own entry and stores its estimate separately", async () => {
    const owner = await dbUserStore.ensureUser("auth0|manual-owner");
    const other = await dbUserStore.ensureUser("auth0|manual-other");
    const id = await saveManualActivity(owner.id, {
      startDate: "2026-10-20",
      details: "An easy hour on the bike",
      estimatedTss: 40,
    });

    const updated = await updateManualActivity(owner.id, id, {
      startDate: "2026-10-20",
      details: "A hard hour on the bike",
      estimatedTss: null,
    });
    await updateManualActivityTss(owner.id, id, 96);

    expect(updated).toBe(true);
    const [stored] = await loadManualActivities(owner.id);
    expect(stored?.details).toBe("A hard hour on the bike");
    expect(stored?.estimatedTss).toBe(96);

    // A foreign account's id answers exactly like a missing one and leaves the
    // athlete's entry untouched.
    expect(
      await updateManualActivity(other.id, id, {
        startDate: "2026-10-20",
        details: "Not my entry",
        estimatedTss: null,
      }),
    ).toBe(false);
    expect(
      await updateManualActivity(other.id, id + 1, {
        startDate: "2026-10-20",
        details: "Not my entry",
        estimatedTss: null,
      }),
    ).toBe(false);
    await updateManualActivityTss(other.id, id, 200);
    expect((await loadManualActivities(owner.id))[0]?.estimatedTss).toBe(96);
  });

  it("refuses a manual entry without a full date or non-blank details", async () => {
    const user = await dbUserStore.ensureUser("auth0|manual-checks");

    for (const input of [
      { startDate: "2026-10-2", details: "An easy hour" },
      { startDate: "2026-10-20", details: "   " },
    ]) {
      let code: string | undefined;
      try {
        await db.insert(manualActivities).values({ userId: user.id, ...input });
      } catch (error) {
        code = postgresErrorCode(error);
      }
      expect(code).toBe("23514");
    }
  });
});
