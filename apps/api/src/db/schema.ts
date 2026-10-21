import type {
  BlockPlan,
  DayPlan,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Placeholder table to prove out the Drizzle + Postgres wiring.
 * Will be replaced by the real athlete/training data model.
 */
export const athletes = pgTable("athletes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Athlete = typeof athletes.$inferSelect;
export type NewAthlete = typeof athletes.$inferInsert;

/**
 * An application account, keyed by the auth provider's subject (`sub`). Roles
 * live here rather than in the token so authorisation is owned by the app and
 * survives provider changes (ADR 0006). The first account provisioned in an
 * environment is an admin; everyone after is a member.
 */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    authSubject: text("auth_subject").notNull().unique(),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("users_role_check", sql`${table.role} in ('admin', 'member')`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/**
 * Single-row Garmin connection (ADR 0003: one operator). Username and password
 * are stored AES-256-GCM-encrypted; ciphertext is never serialized.
 */
export const garminConnections = pgTable("garmin_connections", {
  id: serial("id").primaryKey(),
  usernameEncrypted: text("username_encrypted").notNull(),
  passwordEncrypted: text("password_encrypted").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GarminConnection = typeof garminConnections.$inferSelect;
export type NewGarminConnection = typeof garminConnections.$inferInsert;

/**
 * Single-row LLM provider configuration (single-operator phase). The API key is
 * AES-256-GCM-encrypted at rest and never serialized. `provider` is stored now
 * so another provider can be added without a schema change.
 */
export const llmSettings = pgTable("llm_settings", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("openrouter"),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  model: text("model").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LlmSetting = typeof llmSettings.$inferSelect;
export type NewLlmSetting = typeof llmSettings.$inferInsert;

/**
 * Cached coach analysis for one activity, keyed by the source activity id.
 * Reused across page visits; regenerated when the selected model changes.
 */
export const activityAnalyses = pgTable("activity_analyses", {
  id: serial("id").primaryKey(),
  // Garmin activity ids are ~2.5e10, beyond a 32-bit integer. `mode: "number"`
  // is safe for the full range of ids we receive (well under 2^53).
  activityId: bigint("activity_id", { mode: "number" }).notNull().unique(),
  model: text("model").notNull(),
  promptVersion: integer("prompt_version").notNull().default(1),
  analysis: text("analysis").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ActivityAnalysis = typeof activityAnalyses.$inferSelect;
export type NewActivityAnalysis = typeof activityAnalyses.$inferInsert;

/**
 * Stable identity for an athlete question. The wording lives in
 * `question_versions` and is append-only; `currentVersion` points at the version
 * athletes are asked now. Deleting archives the question so historical answers
 * keep referring to intact versions.
 */
export const questions = pgTable("questions", {
  id: serial("id").primaryKey(),
  currentVersion: integer("current_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;

/**
 * Immutable prompt content for one version of a question. Future answers should
 * reference `id` so the exact wording is preserved.
 */
export const questionVersions = pgTable(
  "question_versions",
  {
    id: serial("id").primaryKey(),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    prompt: text("prompt").notNull(),
    required: boolean("required").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("question_versions_question_id_version_idx").on(
      table.questionId,
      table.version,
    ),
  ],
);

export type QuestionVersionRow = typeof questionVersions.$inferSelect;
export type NewQuestionVersion = typeof questionVersions.$inferInsert;

/**
 * One athlete's answer to an exact question version (ADR 0007). The version
 * reference pins the wording the athlete saw; a unique `(user_id,
 * question_version_id)` pair makes resubmission an upsert. A null answer records
 * an explicit skip of an optional question. Answers to old versions and archived
 * questions are retained.
 */
export const questionAnswers = pgTable(
  "question_answers",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionVersionId: integer("question_version_id")
      .notNull()
      .references(() => questionVersions.id, { onDelete: "cascade" }),
    // Null means the athlete explicitly skipped an optional question.
    answer: text("answer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("question_answers_user_id_question_version_id_idx").on(
      table.userId,
      table.questionVersionId,
    ),
    check(
      "question_answers_answer_check",
      sql`${table.answer} is null or length(btrim(${table.answer})) > 0`,
    ),
  ],
);

export type QuestionAnswerRow = typeof questionAnswers.$inferSelect;
export type NewQuestionAnswer = typeof questionAnswers.$inferInsert;

/**
 * The athlete's current four-level coach plan. One row per user; a regeneration
 * replaces the stored JSON while keeping the previous plan visible until the
 * new one is ready. The date columns duplicate values inside the JSON so the
 * pending/staleness checks can be done without parsing and are easy to index.
 */
export const coachPlans = pgTable(
  "coach_plans",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    season: jsonb("season").$type<SeasonPlan>().notNull(),
    block: jsonb("block").$type<BlockPlan>().notNull(),
    week: jsonb("week").$type<WeekPlan>().notNull(),
    today: jsonb("today").$type<DayPlan>().notNull(),
    /** Suggested session for tomorrow; shown after 18:00 local time. */
    tomorrow: jsonb("tomorrow").$type<DayPlan | null>(),
    dayDate: text("day_date").notNull(),
    weekStartDate: text("week_start_date").notNull(),
    blockStartDate: text("block_start_date").notNull(),
    blockEndDate: text("block_end_date").notNull(),
    seasonStartDate: text("season_start_date").notNull(),
    seasonEndDate: text("season_end_date").notNull(),
    // The newest question-answer timestamp included in this plan. A newer answer
    // makes the plan stale and triggers a regeneration.
    answersUpdatedAt: timestamp("answers_updated_at", { withTimezone: true }),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("coach_plans_user_id_idx").on(table.userId)],
);

export type CoachPlanRow = typeof coachPlans.$inferSelect;
export type NewCoachPlan = typeof coachPlans.$inferInsert;

/**
 * Per-user generation status used by the UI to show progress while the coach is
 * thinking. A single row is upserted; `begin` refuses to start a second run
 * while the status is `running`.
 */
export const planGenerations = pgTable(
  "plan_generations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["idle", "running", "done", "error"] })
      .notNull()
      .default("idle"),
    step: text("step"),
    progress: integer("progress").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("plan_generations_user_id_idx").on(table.userId),
    check(
      "plan_generations_status_check",
      sql`${table.status} in ('idle', 'running', 'done', 'error')`,
    ),
    check(
      "plan_generations_progress_check",
      sql`${table.progress} >= 0 and ${table.progress} <= 100`,
    ),
  ],
);

export type PlanGenerationRow = typeof planGenerations.$inferSelect;
export type NewPlanGeneration = typeof planGenerations.$inferInsert;
