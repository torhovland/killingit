ALTER TABLE "activity_analyses" ADD COLUMN "plan_change_scope" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_replies" ADD COLUMN "plan_change_scope" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
UPDATE "activity_analyses" SET "plan_change_scope" = CASE WHEN "plan_change_needed" THEN 'season' ELSE 'none' END;--> statement-breakpoint
UPDATE "coach_replies" SET "plan_change_scope" = CASE WHEN "plan_change_needed" THEN 'season' ELSE 'none' END;--> statement-breakpoint
ALTER TABLE "activity_analyses" ADD CONSTRAINT "activity_analyses_plan_change_scope_check" CHECK ("activity_analyses"."plan_change_scope" in ('none', 'day', 'week', 'block', 'season'));--> statement-breakpoint
ALTER TABLE "coach_replies" ADD CONSTRAINT "coach_replies_plan_change_scope_check" CHECK ("coach_replies"."plan_change_scope" in ('none', 'day', 'week', 'block', 'season'));