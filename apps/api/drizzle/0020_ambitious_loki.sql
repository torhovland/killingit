ALTER TABLE "athletes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "athletes" CASCADE;--> statement-breakpoint

-- Activity analyses become per account. Backfill from the cached feeds, which
-- are already per user, then drop rows that belonged to activities no longer in
-- any feed: they are a regenerable cache and cannot be attributed safely.
DROP INDEX "activity_analyses_activity_id_kind_idx";--> statement-breakpoint
ALTER TABLE "activity_analyses" ADD COLUMN "user_id" integer;--> statement-breakpoint
UPDATE "activity_analyses" a
SET "user_id" = c."user_id"
FROM "activity_feed_cache" c
WHERE EXISTS (
	SELECT 1
	FROM jsonb_array_elements(c."feed" -> 'activities') AS activity
	WHERE (activity ->> 'id')::bigint = a."activity_id"
);--> statement-breakpoint
DELETE FROM "activity_analyses" WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "activity_analyses" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- LLM settings become per account. The single shared configuration is copied
-- to every existing account so nobody loses access, then the original global
-- row is removed.
ALTER TABLE "llm_settings" ADD COLUMN "user_id" integer;--> statement-breakpoint
INSERT INTO "llm_settings" ("user_id", "provider", "api_key_encrypted", "model", "updated_at")
SELECT u."id", l."provider", l."api_key_encrypted", l."model", l."updated_at"
FROM "llm_settings" l
CROSS JOIN "users" u
WHERE l."user_id" IS NULL;--> statement-breakpoint
DELETE FROM "llm_settings" WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "llm_settings" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "activity_analyses" ADD CONSTRAINT "activity_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD CONSTRAINT "llm_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_analyses_user_id_activity_id_kind_idx" ON "activity_analyses" USING btree ("user_id","activity_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_settings_user_id_idx" ON "llm_settings" USING btree ("user_id");
