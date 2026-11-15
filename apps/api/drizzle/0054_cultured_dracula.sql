-- Thresholds own FTP now (migration 0032 moved the rows and deleted them), but
-- a database restored from before that migration, or one edited by hand, can
-- still hold an `ftp` value. Move any survivor into `athlete_thresholds` before
-- the narrowed check below would reject it, so this migration cannot fail on
-- existing data. A same-day threshold already present wins.
INSERT INTO "athlete_thresholds" ("user_id", "sport", "measure", "label", "unit", "kind", "source", "date", "value", "created_at", "updated_at")
SELECT "user_id", 'cycling', 'ftp', 'FTP', 'W', 'power', "source", "date", "value", "created_at", "updated_at"
FROM "athlete_metrics"
WHERE "metric" = 'ftp'
ON CONFLICT ("user_id", "sport", "measure", "date") DO NOTHING;--> statement-breakpoint
DELETE FROM "athlete_metrics" WHERE "metric" = 'ftp';--> statement-breakpoint
ALTER TABLE "athlete_metrics" DROP CONSTRAINT "athlete_metrics_metric_check";--> statement-breakpoint
ALTER TABLE "athlete_metrics" ADD CONSTRAINT "athlete_metrics_metric_check" CHECK ("athlete_metrics"."metric" in ('weight', 'body_fat'));
