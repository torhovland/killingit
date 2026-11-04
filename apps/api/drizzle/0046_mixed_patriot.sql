CREATE TABLE "plan_week_totals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"week_start_date" text NOT NULL,
	"planned_minutes" integer NOT NULL,
	"planned_tss" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_week_totals_minutes_check" CHECK ("plan_week_totals"."planned_minutes" >= 0),
	CONSTRAINT "plan_week_totals_tss_check" CHECK ("plan_week_totals"."planned_tss" >= 0)
);
--> statement-breakpoint
ALTER TABLE "plan_week_totals" ADD CONSTRAINT "plan_week_totals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_week_totals_user_id_week_start_date_idx" ON "plan_week_totals" USING btree ("user_id","week_start_date");