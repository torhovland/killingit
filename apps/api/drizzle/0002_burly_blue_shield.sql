CREATE TABLE "activity_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"activity_id" integer NOT NULL,
	"model" text NOT NULL,
	"analysis" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_analyses_activity_id_unique" UNIQUE("activity_id")
);
--> statement-breakpoint
CREATE TABLE "llm_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'openrouter' NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"model" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
