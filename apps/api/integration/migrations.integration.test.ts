import "./setup.js";
import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { db } from "../src/db/index.js";
import {
  athleteMetrics,
  athleteThresholds,
  coachQuestions,
  llmSettings,
  manualActivities,
  planDayCalories,
} from "../src/db/schema.js";
import * as dbSchema from "../src/db/schema.js";
import { loadMetricPoints } from "../src/metrics/store.js";
import { dbUserStore } from "../src/users/store.js";
import {
  countRows,
  listPublicTables,
  type MigrationResult,
} from "./database.js";
import { postgresErrorCode, thresholdPointsOf } from "./helpers.js";
import { setupIntegrationSuite } from "./setup.js";

let migrationResult: MigrationResult | undefined;

setupIntegrationSuite((result) => {
  migrationResult = result;
});

/** The tables whose indexes this suite keeps in step with the schema. */
const INDEXED_TABLES = [
  athleteMetrics,
  athleteThresholds,
  coachQuestions,
  manualActivities,
  planDayCalories,
];

const MIGRATIONS_FOLDER = join(import.meta.dir, "..", "drizzle");

/**
 * Runs one migration's statements again. The suite migrates from empty, so a
 * migration that repairs old rows needs its real SQL applied to a simulated
 * pre-state to prove it cannot fail on data an existing database may hold.
 */
async function applyMigration(prefix: string): Promise<void> {
  const files = (await readdir(MIGRATIONS_FOLDER)).filter((file) =>
    file.startsWith(`${prefix}_`),
  );
  if (files.length !== 1 || files[0] === undefined) {
    throw new Error(`expected exactly one ${prefix} migration file`);
  }
  const migration = await readFile(join(MIGRATIONS_FOLDER, files[0]), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim() !== "") {
      await db.execute(sql.raw(statement));
    }
  }
}

/** Every index PostgreSQL reports for one public table, in name order. */
async function listIndexes(table: string): Promise<string[]> {
  const result = await db.execute<{ indexname: string }>(
    sql`select indexname from pg_indexes where schemaname = 'public' and tablename = ${table} order by indexname`,
  );
  return result.rows.map((row) => row.indexname);
}

/** Every check constraint PostgreSQL reports for one public table, by name. */
async function listCheckConstraints(table: string): Promise<string[]> {
  const result = await db.execute<{ conname: string }>(
    sql`
      select conname
      from pg_constraint
      join pg_class on pg_class.oid = pg_constraint.conrelid
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public'
        and pg_class.relname = ${table}
        and pg_constraint.contype = 'c'
      order by conname
    `,
  );
  return result.rows.map((row) => row.conname);
}

describe("migrations", () => {
  it("applies every migration to an empty database", () => {
    expect(migrationResult).toBeDefined();
    expect(migrationResult?.applied).toBe(migrationResult?.expected);
    expect(migrationResult?.expected).toBeGreaterThan(0);
  });

  it("creates the tables the stores and lifecycle tests use", async () => {
    const tables = await listPublicTables();
    const requiredTables = [
      "activities",
      "coach_plans",
      "plan_week_totals",
      "plan_day_calories",
      "plan_generations",
      "questions",
      "question_versions",
      "question_answers",
      "coaching_survey_adjustments",
      "users",
    ];
    for (const table of requiredTables) {
      expect(tables).toContain(table);
    }
  });

  it("keeps one index for each column prefix and ordering the queries use", async () => {
    // Each unique index already covers its table's shorter lookup, so a second
    // index on the same prefix only adds write cost.
    expect(await listIndexes("athlete_metrics")).toEqual([
      "athlete_metrics_pkey",
      "athlete_metrics_user_id_metric_date_idx",
    ]);
    expect(await listIndexes("athlete_thresholds")).toEqual([
      "athlete_thresholds_pkey",
      "athlete_thresholds_user_sport_measure_date_idx",
    ]);
    expect(await listIndexes("plan_day_calories")).toEqual([
      "plan_day_calories_pkey",
      "plan_day_calories_user_id_date_idx",
    ]);

    // These tables are read by account, so each has the lookup its queries
    // need and the pending-question rule is a partial unique index.
    expect(await listIndexes("manual_activities")).toEqual([
      "manual_activities_pkey",
      "manual_activities_user_id_idx",
    ]);
    expect(await listIndexes("coach_questions")).toEqual([
      "coach_questions_pkey",
      "coach_questions_user_id_created_at_idx",
      "coach_questions_user_id_pending_idx",
    ]);
  });

  it("keeps the schema's indexes and the migrated database in step", async () => {
    for (const table of INDEXED_TABLES) {
      const config = getTableConfig(table);
      const declared = config.indexes
        .map((index) => index.config.name)
        .filter((name): name is string => name !== undefined)
        .sort();
      const migrated = (await listIndexes(config.name)).filter(
        (name) => name !== `${config.name}_pkey`,
      );
      expect(migrated).toEqual(declared);
    }
  });

  it("keeps every declared check and the migrated database in step", async () => {
    for (const table of Object.values(dbSchema)) {
      const config = getTableConfig(table);
      const declared = config.checks.map((entry) => entry.name).sort();
      expect(await listCheckConstraints(config.name)).toEqual(declared);
    }
  });

  it("moves a legacy ftp metric into thresholds before narrowing the check", async () => {
    const user = await dbUserStore.ensureUser("auth0|legacy-ftp-metric");
    // Put the table back in its pre-0054 shape: the old check still allowed
    // `ftp`, and a database restored from before migration 0032 can hold one.
    await db.execute(
      sql`alter table athlete_metrics drop constraint athlete_metrics_metric_check`,
    );
    await db.execute(
      sql`alter table athlete_metrics add constraint athlete_metrics_metric_check check (metric in ('ftp', 'weight', 'body_fat'))`,
    );
    await db.execute(
      sql`insert into athlete_metrics (user_id, metric, source, date, value)
          values (${user.id}, 'ftp', 'user', '2026-01-04', 999),
                 (${user.id}, 'ftp', 'coach', '2026-01-05', 250),
                 (${user.id}, 'weight', 'user', '2026-01-05', 81)`,
    );
    // A same-day threshold already stored by the athlete wins over the legacy
    // metric row, so the repair never overwrites a newer measurement.
    await db.insert(athleteThresholds).values({
      userId: user.id,
      sport: "cycling",
      measure: "ftp",
      label: "FTP",
      unit: "W",
      kind: "power",
      source: "user",
      date: "2026-01-04",
      value: 240,
    });

    await applyMigration("0054");

    expect(await thresholdPointsOf(user.id)).toEqual([
      {
        sport: "cycling",
        measure: "ftp",
        label: "FTP",
        unit: "W",
        kind: "power",
        source: "user",
        date: "2026-01-04",
        value: 240,
      },
      {
        sport: "cycling",
        measure: "ftp",
        label: "FTP",
        unit: "W",
        kind: "power",
        source: "coach",
        date: "2026-01-05",
        value: 250,
      },
    ]);
    expect(await loadMetricPoints(user.id, "weight")).toEqual([
      { date: "2026-01-05", value: 81, source: "user" },
    ]);
    expect(await countRows("athlete_metrics")).toBe(1);

    // The narrowed check rejects a new legacy value.
    let code: string | undefined;
    try {
      await db.execute(
        sql`insert into athlete_metrics (user_id, metric, source, date, value)
            values (${user.id}, 'ftp', 'user', '2026-02-01', 260)`,
      );
    } catch (error) {
      code = postgresErrorCode(error);
    }
    expect(code).toBe("23514");
  });

  it("backfills the split models before it drops the legacy column", async () => {
    const legacy = await dbUserStore.ensureUser("auth0|legacy-llm-settings");
    const partial = await dbUserStore.ensureUser("auth0|partial-llm-settings");
    // Put the table back in its pre-0056 shape: the split columns were
    // nullable and the legacy column still held the only stored choice.
    await db.execute(
      sql`alter table llm_settings alter column season_model drop not null`,
    );
    await db.execute(
      sql`alter table llm_settings alter column daily_model drop not null`,
    );
    await db.execute(sql`alter table llm_settings add column model text`);
    await db.execute(
      sql`alter table llm_settings alter column model set not null`,
    );
    await db.execute(
      sql`insert into llm_settings (user_id, provider, api_key_encrypted, model)
          values (${legacy.id}, 'openrouter', 'ciphertext', 'legacy/model')`,
    );
    await db.execute(
      sql`insert into llm_settings
            (user_id, provider, api_key_encrypted, model, season_model)
          values (${partial.id}, 'openrouter', 'ciphertext', 'legacy/model', 'season/model')`,
    );

    await applyMigration("0056");

    const rows = await db
      .select({
        userId: llmSettings.userId,
        seasonModel: llmSettings.seasonModel,
        dailyModel: llmSettings.dailyModel,
      })
      .from(llmSettings)
      .orderBy(llmSettings.userId);
    expect(rows).toEqual([
      {
        userId: legacy.id,
        seasonModel: "legacy/model",
        dailyModel: "legacy/model",
      },
      {
        userId: partial.id,
        seasonModel: "season/model",
        dailyModel: "legacy/model",
      },
    ]);
    const columns = await db.execute<{
      column_name: string;
      is_nullable: string;
    }>(sql`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'llm_settings'
        and column_name in ('model', 'season_model', 'daily_model')
      order by column_name
    `);
    expect(columns.rows).toEqual([
      { column_name: "daily_model", is_nullable: "NO" },
      { column_name: "season_model", is_nullable: "NO" },
    ]);
  });
});
