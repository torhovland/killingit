ALTER TABLE "questions" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "questions" SET "position" = "id";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text;