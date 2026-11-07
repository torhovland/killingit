CREATE TABLE "food_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"eaten_at" timestamp with time zone NOT NULL,
	"eaten_date" text NOT NULL,
	"eaten_time" text NOT NULL,
	"description" text NOT NULL,
	"photo_data_url" text,
	"analysis" jsonb,
	"model" text,
	"analysis_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_entries_description_check" CHECK (length(btrim("food_entries"."description")) > 0),
	CONSTRAINT "food_entries_eaten_date_check" CHECK (length("food_entries"."eaten_date") = 10),
	CONSTRAINT "food_entries_eaten_time_check" CHECK (length("food_entries"."eaten_time") = 5),
	CONSTRAINT "food_entries_analysis_error_check" CHECK ("food_entries"."analysis_error" is null or length(btrim("food_entries"."analysis_error")) > 0)
);
--> statement-breakpoint
ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_kind_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "diet_advice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "food_entries" ADD CONSTRAINT "food_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_entries_user_id_eaten_at_idx" ON "food_entries" USING btree ("user_id","eaten_at");--> statement-breakpoint
CREATE INDEX "food_entries_user_id_eaten_date_idx" ON "food_entries" USING btree ("user_id","eaten_date");--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_kind_check" CHECK ("llm_calls"."kind" in ('coach_plan', 'season_plan', 'initial_block', 'plan_update', 'daily_update', 'target_day_update', 'weekly_update', 'season_refresh', 'block_update', 'activity_analysis', 'program_analysis', 'athlete_metrics', 'athlete_events', 'coach_reply', 'coaching_question', 'period_review', 'manual_tss', 'food_analysis', 'other'));