UPDATE "llm_settings" SET "season_model" = COALESCE("season_model", "model"), "daily_model" = COALESCE("daily_model", "model");--> statement-breakpoint
ALTER TABLE "llm_settings" ALTER COLUMN "season_model" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_settings" ALTER COLUMN "daily_model" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_settings" DROP COLUMN "model";
