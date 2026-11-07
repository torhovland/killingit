CREATE TABLE "plan_day_calories" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"date" text NOT NULL,
	"calories_kcal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_day_calories_date_check" CHECK (length("plan_day_calories"."date") = 10),
	CONSTRAINT "plan_day_calories_kcal_check" CHECK ("plan_day_calories"."calories_kcal" >= 0)
);
--> statement-breakpoint
ALTER TABLE "coach_plans" ADD COLUMN "diet" jsonb;--> statement-breakpoint
ALTER TABLE "plan_day_calories" ADD CONSTRAINT "plan_day_calories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_day_calories_user_id_date_idx" ON "plan_day_calories" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "plan_day_calories_user_id_date_order_idx" ON "plan_day_calories" USING btree ("user_id","date");