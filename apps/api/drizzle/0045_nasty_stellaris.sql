CREATE TABLE "athlete_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athlete_events_title_check" CHECK (length(btrim("athlete_events"."title")) > 0),
	CONSTRAINT "athlete_events_kind_check" CHECK ("athlete_events"."kind" in ('race', 'event', 'trip', 'goal')),
	CONSTRAINT "athlete_events_date_check" CHECK ("athlete_events"."end_date" is null or "athlete_events"."end_date" >= "athlete_events"."start_date")
);
--> statement-breakpoint
ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_kind_check";--> statement-breakpoint
ALTER TABLE "athlete_events" ADD CONSTRAINT "athlete_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "athlete_events_user_id_start_date_idx" ON "athlete_events" USING btree ("user_id","start_date");--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_kind_check" CHECK ("llm_calls"."kind" in ('coach_plan', 'season_plan', 'initial_block', 'plan_update', 'daily_update', 'target_day_update', 'weekly_update', 'season_refresh', 'block_update', 'activity_analysis', 'program_analysis', 'athlete_metrics', 'athlete_events', 'coach_reply', 'coaching_question', 'period_review', 'manual_tss', 'other'));