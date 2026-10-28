CREATE TABLE "llm_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"messages" jsonb NOT NULL,
	"response" text,
	"error" text,
	"usage" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_calls_kind_check" CHECK ("llm_calls"."kind" in ('coach_plan', 'season_plan', 'initial_block', 'daily_update', 'target_day_update', 'weekly_update', 'season_refresh', 'block_update', 'activity_analysis', 'program_analysis', 'coach_reply', 'coaching_question', 'period_review', 'manual_tss', 'other')),
	CONSTRAINT "llm_calls_duration_ms_check" CHECK ("llm_calls"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_calls_created_at_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_user_id_created_at_idx" ON "llm_calls" USING btree ("user_id","created_at");