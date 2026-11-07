ALTER TABLE "food_entries" DROP CONSTRAINT "food_entries_description_check";--> statement-breakpoint
ALTER TABLE "food_entries" ALTER COLUMN "description" DROP NOT NULL;