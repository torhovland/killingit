CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"activity_id" bigint NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"distance" double precision NOT NULL,
	"moving_time" double precision NOT NULL,
	"elapsed_time" double precision NOT NULL,
	"total_elevation_gain" double precision NOT NULL,
	"average_power" double precision,
	"normalized_power" double precision,
	"average_heart_rate" double precision,
	"average_speed" double precision,
	"max_speed" double precision,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"strength_sets" jsonb,
	"laps" jsonb,
	"samples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"route" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_user_id_activity_id_idx" ON "activities" USING btree ("user_id","activity_id");--> statement-breakpoint
CREATE INDEX "activities_user_id_start_date_idx" ON "activities" USING btree ("user_id","start_date");
--> statement-breakpoint
-- Preserve the history the JSONB feed held, including activities that have
-- already left Garmin's 42-day sync window. Analyses, comments and replies
-- already live in their own tables, so only the activity rows are copied.
INSERT INTO "activities" (
	"user_id",
	"activity_id",
	"name",
	"type",
	"start_date",
	"distance",
	"moving_time",
	"elapsed_time",
	"total_elevation_gain",
	"average_power",
	"normalized_power",
	"average_heart_rate",
	"average_speed",
	"max_speed",
	"sample_count",
	"strength_sets",
	"laps",
	"samples",
	"route"
)
SELECT
	cache."user_id",
	(activity ->> 'id')::bigint,
	activity ->> 'name',
	activity ->> 'type',
	(activity ->> 'startDate')::timestamptz,
	COALESCE((activity ->> 'distance')::double precision, 0),
	COALESCE((activity ->> 'movingTime')::double precision, 0),
	COALESCE((activity ->> 'elapsedTime')::double precision, 0),
	COALESCE((activity ->> 'totalElevationGain')::double precision, 0),
	(activity ->> 'averagePower')::double precision,
	(activity ->> 'normalizedPower')::double precision,
	(activity ->> 'averageHeartRate')::double precision,
	(activity ->> 'averageSpeed')::double precision,
	(activity ->> 'maxSpeed')::double precision,
	COALESCE((activity ->> 'sampleCount')::integer, 0),
	CASE
		WHEN jsonb_typeof(activity -> 'strengthSets') = 'array' THEN activity -> 'strengthSets'
	END,
	CASE
		WHEN jsonb_typeof(activity -> 'laps') = 'array' THEN activity -> 'laps'
	END,
	COALESCE(activity -> 'samples', '[]'::jsonb),
	CASE
		WHEN jsonb_typeof(activity -> 'route') = 'array' THEN activity -> 'route'
	END
FROM "activity_feed_cache" AS cache
CROSS JOIN LATERAL jsonb_array_elements(cache."feed" -> 'activities') AS activity
ON CONFLICT ("user_id", "activity_id") DO NOTHING;
--> statement-breakpoint
DROP TABLE "activity_feed_cache" CASCADE;
