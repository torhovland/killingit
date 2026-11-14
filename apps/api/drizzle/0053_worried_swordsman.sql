DROP INDEX "athlete_metrics_user_id_metric_idx";--> statement-breakpoint
DROP INDEX "athlete_thresholds_user_sport_measure_idx";--> statement-breakpoint
DROP INDEX "plan_day_calories_user_id_date_order_idx";--> statement-breakpoint
-- The write path keeps at most one pending question per account, but the rule
-- was only a convention. Keep the newest unanswered row before the partial
-- unique index turns it into a database constraint.
DELETE FROM "coach_questions" AS older
USING "coach_questions" AS newer
WHERE older."user_id" = newer."user_id"
	AND older."answer" IS NULL
	AND newer."answer" IS NULL
	AND (newer."created_at", newer."id") > (older."created_at", older."id");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_questions_user_id_pending_idx" ON "coach_questions" USING btree ("user_id") WHERE "coach_questions"."answer" is null;--> statement-breakpoint
CREATE INDEX "manual_activities_user_id_idx" ON "manual_activities" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "manual_activities" ADD CONSTRAINT "manual_activities_start_date_check" CHECK (length("manual_activities"."start_date") = 10);--> statement-breakpoint
ALTER TABLE "manual_activities" ADD CONSTRAINT "manual_activities_details_check" CHECK (length(btrim("manual_activities"."details")) > 0);