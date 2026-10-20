import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
