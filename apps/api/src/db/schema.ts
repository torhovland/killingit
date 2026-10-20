import {
  bigint,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
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
