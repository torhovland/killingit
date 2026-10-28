CREATE TABLE "athlete_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"metric" text NOT NULL,
	"source" text NOT NULL,
	"date" text NOT NULL,
	"value" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athlete_metrics_metric_check" CHECK ("athlete_metrics"."metric" in ('ftp', 'weight', 'body_fat')),
	CONSTRAINT "athlete_metrics_source_check" CHECK ("athlete_metrics"."source" in ('user', 'coach', 'garmin'))
);
--> statement-breakpoint
ALTER TABLE "athlete_metrics" ADD CONSTRAINT "athlete_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "athlete_metrics_user_id_metric_date_idx" ON "athlete_metrics" USING btree ("user_id","metric","date");--> statement-breakpoint
CREATE INDEX "athlete_metrics_user_id_metric_idx" ON "athlete_metrics" USING btree ("user_id","metric");