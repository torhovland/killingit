CREATE TABLE "plan_generation_step_durations" (
	"step_id" text PRIMARY KEY NOT NULL,
	"average_ms" integer NOT NULL,
	"samples" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_generation_step_durations_average_check" CHECK ("plan_generation_step_durations"."average_ms" > 0)
);
--> statement-breakpoint
ALTER TABLE "plan_generations" ADD COLUMN "step_id" text;--> statement-breakpoint
ALTER TABLE "plan_generations" ADD COLUMN "progress_end" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_generations" ADD COLUMN "step_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_generations" ADD COLUMN "step_expected_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_generations" ADD CONSTRAINT "plan_generations_progress_end_check" CHECK ("plan_generations"."progress_end" >= 0 and "plan_generations"."progress_end" <= 100);