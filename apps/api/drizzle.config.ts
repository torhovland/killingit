import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations must use the direct (unpooled) endpoint: PgBouncer / the Neon
    // pooled endpoint can break DDL. Falls back to DATABASE_URL for local dev.
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      "postgres://killingit:killingit@localhost:5432/killingit",
  },
});
