import "./setup.js";
import { describe, expect, it } from "bun:test";
import type { FoodAnalysis } from "@killingit/shared";
import { dbFoodEntryStore, type NewFoodEntry } from "../src/diet/store.js";
import { dbUserStore } from "../src/users/store.js";
import { postgresErrorCode } from "./helpers.js";
import { setupIntegrationSuite } from "./setup.js";

setupIntegrationSuite();

const ANALYSIS: FoodAnalysis = {
  meal: "Porridge with berries",
  carbsGrams: 60,
  proteinGrams: 12,
  fatGrams: 8,
  caloriesKcal: 420,
  dietFit: "A good breakfast before an easy ride.",
};

const BREAKFAST: NewFoodEntry = {
  eatenAt: new Date("2026-11-09T07:30:00.000Z"),
  eatenDate: "2026-11-09",
  eatenTime: "07:30",
  description: "Porridge with berries",
  thumbnailDataUrl: "data:image/jpeg;base64,AAAA",
  analysis: ANALYSIS,
  model: "test/model",
  analysisError: null,
};

describe("dbFoodEntryStore", () => {
  it("stores every field of a logged meal and reads it back", async () => {
    const user = await dbUserStore.ensureUser("auth0|food-create");
    const created = await dbFoodEntryStore.create(user.id, BREAKFAST);

    expect(created.eatenAt.toISOString()).toBe("2026-11-09T07:30:00.000Z");
    expect(created).toMatchObject({
      eatenDate: "2026-11-09",
      eatenTime: "07:30",
      description: "Porridge with berries",
      thumbnailDataUrl: "data:image/jpeg;base64,AAAA",
      analysis: ANALYSIS,
      model: "test/model",
      analysisError: null,
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    expect(await dbFoodEntryStore.findForUser(user.id, created.id)).toEqual(
      created,
    );
    expect(await dbFoodEntryStore.photo(user.id, created.id)).toBe(
      "data:image/jpeg;base64,AAAA",
    );
    expect(await dbFoodEntryStore.listForUser(user.id)).toEqual([created]);
  });

  it("orders the diet log newest first and the prompt summary oldest first", async () => {
    const user = await dbUserStore.ensureUser("auth0|food-order");
    for (const [date, time, description] of [
      ["2026-11-08", "07:00", "Day one"],
      ["2026-11-09", "07:30", "Day two"],
      ["2026-11-10", "08:00", "Day three"],
    ] as const) {
      await dbFoodEntryStore.create(user.id, {
        ...BREAKFAST,
        eatenAt: new Date(`${date}T${time}:00.000Z`),
        eatenDate: date,
        eatenTime: time,
        description,
      });
    }

    expect(
      (await dbFoodEntryStore.listForUser(user.id)).map(
        (entry) => entry.description,
      ),
    ).toEqual(["Day three", "Day two", "Day one"]);
    expect(
      (await dbFoodEntryStore.listSince(user.id, "2026-11-09")).map(
        (entry) => entry.description,
      ),
    ).toEqual(["Day two", "Day three"]);
    expect(await dbFoodEntryStore.listSince(user.id, "2026-11-11")).toEqual([]);
  });

  it("keeps each account's meals out of the other's reads and writes", async () => {
    const owner = await dbUserStore.ensureUser("auth0|food-scope-owner");
    const other = await dbUserStore.ensureUser("auth0|food-scope-other");
    const meal = await dbFoodEntryStore.create(owner.id, BREAKFAST);

    expect(await dbFoodEntryStore.listForUser(other.id)).toEqual([]);
    expect(await dbFoodEntryStore.listSince(other.id, "2026-01-01")).toEqual(
      [],
    );
    expect(await dbFoodEntryStore.findForUser(other.id, meal.id)).toBeNull();
    expect(await dbFoodEntryStore.photo(other.id, meal.id)).toBeNull();
    expect(
      await dbFoodEntryStore.update(other.id, meal.id, {
        ...BREAKFAST,
        description: "Not mine",
      }),
    ).toBeNull();

    // A foreign account's id answers exactly like a missing one and leaves the
    // owner's meal untouched.
    expect(
      (await dbFoodEntryStore.findForUser(owner.id, meal.id))?.description,
    ).toBe("Porridge with berries");
    expect(
      (await dbFoodEntryStore.listForUser(owner.id)).map((entry) => entry.id),
    ).toEqual([meal.id]);
    expect(
      await dbFoodEntryStore.findForUser(owner.id, meal.id + 1),
    ).toBeNull();
  });

  it("replaces every saved field on update and keeps the creation time", async () => {
    const user = await dbUserStore.ensureUser("auth0|food-update");
    const created = await dbFoodEntryStore.create(user.id, BREAKFAST);

    const updated = await dbFoodEntryStore.update(user.id, created.id, {
      ...BREAKFAST,
      eatenAt: new Date("2026-11-10T08:05:00.000Z"),
      eatenDate: "2026-11-10",
      eatenTime: "08:05",
      description: null,
      thumbnailDataUrl: null,
      analysis: null,
      model: null,
      analysisError: "The photo could not be read.",
    });

    expect(updated).not.toBeNull();
    expect(updated?.id).toBe(created.id);
    expect(updated?.eatenDate).toBe("2026-11-10");
    expect(updated?.eatenTime).toBe("08:05");
    expect(updated?.description).toBeNull();
    expect(updated?.thumbnailDataUrl).toBeNull();
    expect(updated?.analysis).toBeNull();
    expect(updated?.model).toBeNull();
    expect(updated?.analysisError).toBe("The photo could not be read.");
    expect(updated?.createdAt.getTime()).toBe(created.createdAt.getTime());
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      created.updatedAt.getTime(),
    );
    expect(await dbFoodEntryStore.photo(user.id, created.id)).toBeNull();
  });

  it("refuses a meal without a full local date or clock time and a blank error", async () => {
    const user = await dbUserStore.ensureUser("auth0|food-checks");

    for (const invalid of [
      { ...BREAKFAST, eatenDate: "2026-11-9" },
      { ...BREAKFAST, eatenTime: "7:30" },
      { ...BREAKFAST, analysisError: "   " },
    ]) {
      let code: string | undefined;
      try {
        await dbFoodEntryStore.create(user.id, invalid);
      } catch (error) {
        code = postgresErrorCode(error);
      }
      expect(code).toBe("23514");
    }

    expect(await dbFoodEntryStore.listForUser(user.id)).toEqual([]);
  });
});
