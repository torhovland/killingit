CREATE TABLE "athlete_daily_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"metric" text NOT NULL,
	"date" text NOT NULL,
	"value" double precision NOT NULL,
	"source" text DEFAULT 'garmin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athlete_daily_metrics_metric_check" CHECK ("athlete_daily_metrics"."metric" in ('resting_heart_rate', 'sleep_duration', 'sleep_score', 'deep_sleep', 'light_sleep', 'rem_sleep', 'awake_sleep', 'hrv', 'spo2', 'respiration', 'stress', 'body_battery_high', 'body_battery_low', 'steps', 'active_calories', 'intensity_minutes', 'training_readiness', 'recovery_time', 'vo2max', 'vo2max_cycling')),
	CONSTRAINT "athlete_daily_metrics_source_check" CHECK ("athlete_daily_metrics"."source" in ('garmin'))
);
--> statement-breakpoint
CREATE TABLE "garmin_daily_sync" (
	"user_id" integer NOT NULL,
	"date" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "garmin_daily_sync_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
ALTER TABLE "athlete_daily_metrics" ADD CONSTRAINT "athlete_daily_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garmin_daily_sync" ADD CONSTRAINT "garmin_daily_sync_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "athlete_daily_metrics_user_id_metric_date_idx" ON "athlete_daily_metrics" USING btree ("user_id","metric","date");--> statement-breakpoint
CREATE INDEX "athlete_daily_metrics_user_id_date_idx" ON "athlete_daily_metrics" USING btree ("user_id","date");