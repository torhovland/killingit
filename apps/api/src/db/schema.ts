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