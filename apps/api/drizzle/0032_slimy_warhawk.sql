CREATE TABLE "athlete_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"sport" text NOT NULL,
	"measure" text NOT NULL,
	"label" text NOT NULL,
	"unit" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"date" text NOT NULL,
	"value" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athlete_thresholds_kind_check" CHECK ("athlete_thresholds"."kind" in ('power', 'heart_rate', 'pace', 'speed', 'stress', 'other')),
	CONSTRAINT "athlete_thresholds_source_check" CHECK ("athlete_thresholds"."source" in ('user', 'coach', 'garmin'))
);
--> statement-breakpoint
ALTER TABLE "athlete_thresholds" ADD CONSTRAINT "athlete_thresholds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "athlete_thresholds_user_sport_measure_date_idx" ON "athlete_thresholds" USING btree ("user_id","sport","measure","date");--> statement-breakpoint
CREATE INDEX "athlete_thresholds_user_sport_measure_idx" ON "athlete_thresholds" USING btree ("user_id","sport","measure");--> statement-breakpoint
INSERT INTO "athlete_thresholds" ("user_id", "sport", "measure", "label", "unit", "kind", "source", "date", "value", "created_at", "updated_at")
SELECT "user_id", 'cycling', 'ftp', 'FTP', 'W', 'power', "source", "date", "value", "created_at", "updated_at"
FROM "athlete_metrics"
WHERE "metric" = 'ftp'
ON CONFLICT ("user_id", "sport", "measure", "date") DO NOTHING;--> statement-breakpoint
DELETE FROM "athlete_metrics" WHERE "metric" = 'ftp';
