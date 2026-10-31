CREATE TABLE "llm_model_sync" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"discouraged" boolean DEFAULT false NOT NULL,
	"ability" text DEFAULT '?' NOT NULL,
	"speed" text DEFAULT '?' NOT NULL,
	"cost" text DEFAULT '?' NOT NULL,
	"benchmark_score" double precision,
	"benchmark_time_ms" integer,
	"benchmark_cost_usd" double precision,
	"benchmark_categories" jsonb,
	"benchmarked_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_models_ability_check" CHECK ("llm_models"."ability" in ('A+', 'A', 'B', 'C', 'D', 'E', 'F', '?')),
	CONSTRAINT "llm_models_speed_check" CHECK ("llm_models"."speed" in ('A+', 'A', 'B', 'C', 'D', 'E', 'F', '?')),
	CONSTRAINT "llm_models_cost_check" CHECK ("llm_models"."cost" in ('A+', 'A', 'B', 'C', 'D', 'E', 'F', '?'))
);
--> statement-breakpoint
ALTER TABLE "llm_settings" ADD COLUMN "season_model" text;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD COLUMN "daily_model" text;