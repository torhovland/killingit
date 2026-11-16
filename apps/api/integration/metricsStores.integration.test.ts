import "./setup.js";
import { describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { athleteMetrics } from "../src/db/schema.js";
import {
  loadMetricPoints,
  recordAthleteMetricStatements,
  recordCoachFtp,
  recordGarminBodyMetrics,
  recordGarminFtp,
  recordPlanFtpEstimates,
} from "../src/metrics/store.js";
import { dbUserStore } from "../src/users/store.js";
import { thresholdPointsOf } from "./helpers.js";
import { setupIntegrationSuite } from "./setup.js";

setupIntegrationSuite();

/**
 * Makes one metric write fail the way a crash or constraint violation would,
 * so a rewrite that deletes before it inserts can be tested between the two.
 */
async function withInjectedInsertFailure(
  table: "athlete_metrics" | "athlete_thresholds",
  marker: number,
  run: () => Promise<void>,
): Promise<void> {
  const trigger = `${table}_integration_failure`;
  await db.execute(sql.raw(`drop trigger if exists ${trigger} on ${table}`));
  await db.execute(
    sql.raw(`
      create or replace function ${trigger}() returns trigger as $$
      begin
        if new.value = ${marker} then
          raise exception 'injected metric write failure';
        end if;
        return new;
      end;
      $$ language plpgsql
    `),
  );
  await db.execute(
    sql.raw(
      `create trigger ${trigger} before insert or update on ${table} ` +
        `for each row execute function ${trigger}()`,
    ),
  );
  try {
    await run();
  } finally {
    await db.execute(sql.raw(`drop trigger if exists ${trigger} on ${table}`));
    await db.execute(sql.raw(`drop function if exists ${trigger}()`));
  }
}

describe("metrics stores", () => {
  const THROUGH_DATE = "2026-11-12";
  const FTP = {
    sport: "cycling",
    measure: "ftp",
    label: "FTP",
    unit: "W",
    kind: "power" as const,
  };

  it("keeps the athlete's points when a reading fails after the delete", async () => {
    const user = await dbUserStore.ensureUser("auth0|metrics-rollback");
    await recordAthleteMetricStatements(
      user.id,
      [
        {
          date: "2026-01-05",
          weightKg: 81,
          bodyFatPercent: 22.5,
          thresholds: [{ ...FTP, value: 250 }],
        },
      ],
      THROUGH_DATE,
    );

    let failed = false;
    await withInjectedInsertFailure("athlete_metrics", 99, async () => {
      try {
        await recordAthleteMetricStatements(
          user.id,
          [
            {
              date: "2026-03-02",
              weightKg: 79,
              bodyFatPercent: 99,
              thresholds: [{ ...FTP, value: 260 }],
            },
          ],
          THROUGH_DATE,
        );
      } catch {
        failed = true;
      }
    });
    expect(failed).toBe(true);

    expect(await loadMetricPoints(user.id, "weight")).toEqual([
      { date: "2026-01-05", value: 81, source: "user" },
    ]);
    expect(await loadMetricPoints(user.id, "body_fat")).toEqual([
      { date: "2026-01-05", value: 22.5, source: "user" },
    ]);
    expect(await thresholdPointsOf(user.id)).toEqual([
      {
        ...FTP,
        date: "2026-01-05",
        value: 250,
        source: "user",
      },
    ]);
  });

  it("replaces only the measures the reading reports and lets the last statement win", async () => {
    const user = await dbUserStore.ensureUser("auth0|metrics-rewrite");
    await db.insert(athleteMetrics).values({
      userId: user.id,
      metric: "weight",
      source: "garmin",
      date: "2026-02-01",
      value: 80.5,
    });
    await recordAthleteMetricStatements(
      user.id,
      [
        {
          date: "2026-01-05",
          weightKg: 81,
          bodyFatPercent: null,
          thresholds: [],
        },
        {
          date: "2026-01-06",
          weightKg: 80.8,
          bodyFatPercent: 22,
          thresholds: [{ ...FTP, value: 250 }],
        },
      ],
      THROUGH_DATE,
    );

    await recordAthleteMetricStatements(
      user.id,
      [
        {
          date: "2026-01-06",
          weightKg: 80.2,
          bodyFatPercent: null,
          thresholds: [],
        },
        {
          date: "2026-01-06",
          weightKg: 80.1,
          bodyFatPercent: null,
          thresholds: [],
        },
      ],
      THROUGH_DATE,
    );

    // The edited-out weight on 5 January is gone, the same-day statements keep
    // the last value, and the Garmin weigh-in and the unreported measures stay.
    expect(await loadMetricPoints(user.id, "weight")).toEqual([
      { date: "2026-01-06", value: 80.1, source: "user" },
      { date: "2026-02-01", value: 80.5, source: "garmin" },
    ]);
    expect(await loadMetricPoints(user.id, "body_fat")).toEqual([
      { date: "2026-01-06", value: 22, source: "user" },
    ]);
    expect(await thresholdPointsOf(user.id)).toEqual([
      { ...FTP, date: "2026-01-06", value: 250, source: "user" },
    ]);
  });

  it("keeps the older coach estimates when a newer one fails to store", async () => {
    const user = await dbUserStore.ensureUser("auth0|coach-threshold-rollback");
    await recordCoachFtp({ userId: user.id, date: "2026-01-01", watts: 240 });
    await recordCoachFtp({ userId: user.id, date: "2026-02-01", watts: 250 });

    let failed = false;
    await withInjectedInsertFailure("athlete_thresholds", 9999, async () => {
      try {
        await recordCoachFtp({
          userId: user.id,
          date: "2026-01-15",
          watts: 9999,
        });
      } catch {
        failed = true;
      }
    });
    expect(failed).toBe(true);

    expect(
      (await thresholdPointsOf(user.id)).map((point) => [
        point.date,
        point.value,
      ]),
    ).toEqual([
      ["2026-01-01", 240],
      ["2026-02-01", 250],
    ]);
  });

  it("stores a Garmin sync's weigh-ins in one batch or not at all", async () => {
    const user = await dbUserStore.ensureUser("auth0|garmin-batch-failure");

    let failed = false;
    await withInjectedInsertFailure("athlete_metrics", 79.9, async () => {
      try {
        await recordGarminBodyMetrics(user.id, [
          { date: "2026-02-01", weightKg: 80.4, bodyFatPercent: 21 },
          { date: "2026-02-02", weightKg: 79.9, bodyFatPercent: 20.9 },
        ]);
      } catch {
        failed = true;
      }
    });
    expect(failed).toBe(true);

    // One statement means a bad sample cannot leave the earlier ones stored.
    expect(await loadMetricPoints(user.id, "weight")).toEqual([]);
    expect(await loadMetricPoints(user.id, "body_fat")).toEqual([]);
  });

  it("stores a Garmin FTP sync in one batch or not at all", async () => {
    const user = await dbUserStore.ensureUser("auth0|garmin-ftp-batch-failure");

    let failed = false;
    await withInjectedInsertFailure("athlete_thresholds", 290, async () => {
      try {
        await recordGarminFtp(user.id, [
          { date: "2026-02-01", watts: 280 },
          { date: "2026-02-02", watts: 290 },
        ]);
      } catch {
        failed = true;
      }
    });
    expect(failed).toBe(true);

    expect(await thresholdPointsOf(user.id)).toEqual([]);
  });

  it("keeps the last value for a day a batch names twice", async () => {
    const user = await dbUserStore.ensureUser(
      "auth0|garmin-batch-duplicate-day",
    );

    await recordGarminBodyMetrics(user.id, [
      { date: "2026-02-01", weightKg: 80.4, bodyFatPercent: 21 },
      { date: "2026-02-01", weightKg: 80.2, bodyFatPercent: 20.8 },
      { date: "2026-02-02", weightKg: 80.0 },
    ]);
    await recordGarminFtp(user.id, [
      { date: "2026-02-01", watts: 280 },
      { date: "2026-02-01", watts: 285 },
    ]);

    expect(await loadMetricPoints(user.id, "weight")).toEqual([
      { date: "2026-02-01", value: 80.2, source: "garmin" },
      { date: "2026-02-02", value: 80.0, source: "garmin" },
    ]);
    expect(await loadMetricPoints(user.id, "body_fat")).toEqual([
      { date: "2026-02-01", value: 20.8, source: "garmin" },
    ]);
    expect(await thresholdPointsOf(user.id)).toEqual([
      { ...FTP, date: "2026-02-01", value: 285, source: "garmin" },
    ]);
  });

  it("keeps an athlete value a Garmin sync finds already stored", async () => {
    const user = await dbUserStore.ensureUser("auth0|garmin-batch-precedence");
    await recordAthleteMetricStatements(
      user.id,
      [
        {
          date: "2026-02-01",
          weightKg: 78,
          bodyFatPercent: null,
          thresholds: [{ ...FTP, value: 260 }],
        },
      ],
      THROUGH_DATE,
    );

    await recordGarminBodyMetrics(user.id, [
      { date: "2026-02-01", weightKg: 79, bodyFatPercent: 22 },
      { date: "2026-02-02", weightKg: 78.5, bodyFatPercent: 21.5 },
    ]);
    await recordGarminFtp(user.id, [
      { date: "2026-02-01", watts: 300 },
      { date: "2026-02-02", watts: 305 },
    ]);

    expect(await loadMetricPoints(user.id, "weight")).toEqual([
      { date: "2026-02-01", value: 78, source: "user" },
      { date: "2026-02-02", value: 78.5, source: "garmin" },
    ]);
    expect(await loadMetricPoints(user.id, "body_fat")).toEqual([
      { date: "2026-02-01", value: 22, source: "garmin" },
      { date: "2026-02-02", value: 21.5, source: "garmin" },
    ]);
    expect(await thresholdPointsOf(user.id)).toEqual([
      { ...FTP, date: "2026-02-01", value: 260, source: "user" },
      { ...FTP, date: "2026-02-02", value: 305, source: "garmin" },
    ]);
  });

  it("applies a batch of plan FTP estimates and drops the projection after the oldest", async () => {
    const user = await dbUserStore.ensureUser("auth0|plan-ftp-batch");
    for (const [date, value] of [
      ["2026-01-01", 240],
      ["2026-01-15", 245],
      ["2026-02-01", 250],
    ] as const) {
      await recordCoachFtp({ userId: user.id, date, watts: value });
    }

    await recordPlanFtpEstimates(user.id, [
      { date: "2026-01-08", watts: 242 },
      { date: "2026-01-20", watts: 248 },
    ]);

    // The estimate before the batch stays, the stale projection after the
    // oldest estimate of the batch goes, and the batch itself is stored.
    expect(
      (await thresholdPointsOf(user.id)).map((point) => [
        point.date,
        point.value,
      ]),
    ).toEqual([
      ["2026-01-01", 240],
      ["2026-01-08", 242],
      ["2026-01-20", 248],
    ]);
  });
});
