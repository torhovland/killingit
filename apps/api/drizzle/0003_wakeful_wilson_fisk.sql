ALTER TABLE "activity_analyses" ALTER COLUMN "activity_id" SET DATA TYPE bigint;
--> statement-breakpoint
-- Single-row integration tables previously appended a row on every save
-- (the sequence advanced instead of conflicting on id). Keep the newest row
-- and renumber it to the fixed singleton id used by the stores.
DELETE FROM "llm_settings" a
USING "llm_settings" b
WHERE a."updated_at" < b."updated_at"
   OR (a."updated_at" = b."updated_at" AND a."id" < b."id");
--> statement-breakpoint
UPDATE "llm_settings" SET "id" = 1 WHERE "id" <> 1;
--> statement-breakpoint
DELETE FROM "garmin_connections" a
USING "garmin_connections" b
WHERE a."updated_at" < b."updated_at"
   OR (a."updated_at" = b."updated_at" AND a."id" < b."id");
--> statement-breakpoint
UPDATE "garmin_connections" SET "id" = 1 WHERE "id" <> 1;
