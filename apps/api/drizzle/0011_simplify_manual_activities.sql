ALTER TABLE "manual_activities" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "manual_activities" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "manual_activities" DROP COLUMN "distance";--> statement-breakpoint
ALTER TABLE "manual_activities" DROP COLUMN "moving_time";--> statement-breakpoint
ALTER TABLE "manual_activities" DROP COLUMN "elapsed_time";--> statement-breakpoint
ALTER TABLE "manual_activities" DROP COLUMN "total_elevation_gain";--> statement-breakpoint
ALTER TABLE "manual_activities" ADD COLUMN "details" text NOT NULL;
