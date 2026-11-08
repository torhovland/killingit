ALTER TABLE "plan_day_calories" ADD COLUMN "basal_metabolism_kcal" integer;--> statement-breakpoint
ALTER TABLE "plan_day_calories" ADD COLUMN "workout_calories_kcal" integer;--> statement-breakpoint
ALTER TABLE "plan_day_calories" ADD COLUMN "diet_deficit_kcal" integer;--> statement-breakpoint
ALTER TABLE "plan_day_calories" ADD CONSTRAINT "plan_day_calories_basal_check" CHECK ("plan_day_calories"."basal_metabolism_kcal" IS NULL OR "plan_day_calories"."basal_metabolism_kcal" >= 0);--> statement-breakpoint
ALTER TABLE "plan_day_calories" ADD CONSTRAINT "plan_day_calories_workout_check" CHECK ("plan_day_calories"."workout_calories_kcal" IS NULL OR "plan_day_calories"."workout_calories_kcal" >= 0);