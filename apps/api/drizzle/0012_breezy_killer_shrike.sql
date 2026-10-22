ALTER TABLE "garmin_connections" ADD COLUMN "user_id" integer;--> statement-breakpoint
-- Attach the existing single-operator credentials to the earliest account (the
-- admin). Rows left orphaned are unusable without a user and are dropped.
UPDATE "garmin_connections" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "id" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
DELETE FROM "garmin_connections" WHERE "user_id" IS NULL;--> statement-breakpoint
DELETE FROM "garmin_connections" a USING "garmin_connections" b WHERE a."user_id" = b."user_id" AND a."id" > b."id";--> statement-breakpoint
ALTER TABLE "garmin_connections" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD CONSTRAINT "garmin_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_connections_user_id_idx" ON "garmin_connections" USING btree ("user_id");
