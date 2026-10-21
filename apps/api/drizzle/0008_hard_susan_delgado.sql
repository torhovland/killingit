CREATE TABLE "coach_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"season" jsonb NOT NULL,
	"block" jsonb NOT NULL,
	"week" jsonb NOT NULL,
	"today" jsonb NOT NULL,
	"day_date" text NOT NULL,
	"week_start_date" text NOT NULL,
	"block_start_date" text NOT NULL,
	"block_end_date" text NOT NULL,
	"season_start_date" text NOT NULL,
	"season_end_date" text NOT NULL,
	"answers_updated_at" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"step" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_generations_status_check" CHECK ("plan_generations"."status" in ('idle', 'running', 'done', 'error')),
	CONSTRAINT "plan_generations_progress_check" CHECK ("plan_generations"."progress" >= 0 and "plan_generations"."progress" <= 100)
);
--> statement-breakpoint
ALTER TABLE "coach_plans" ADD CONSTRAINT "coach_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_generations" ADD CONSTRAINT "plan_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_plans_user_id_idx" ON "coach_plans" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_generations_user_id_idx" ON "plan_generations" USING btree ("user_id");