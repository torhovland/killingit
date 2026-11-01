CREATE TABLE "coaching_survey_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"question" text NOT NULL,
	"previous_question" text,
	"answer" text,
	"previous_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaching_survey_adjustments_question_check" CHECK (length(btrim("coaching_survey_adjustments"."question")) > 0),
	CONSTRAINT "coaching_survey_adjustments_answer_check" CHECK ("coaching_survey_adjustments"."answer" is null or length(btrim("coaching_survey_adjustments"."answer")) > 0),
	CONSTRAINT "coaching_survey_adjustments_previous_answer_check" CHECK ("coaching_survey_adjustments"."previous_answer" is null or length(btrim("coaching_survey_adjustments"."previous_answer")) > 0)
);
--> statement-breakpoint
ALTER TABLE "coaching_survey_adjustments" ADD CONSTRAINT "coaching_survey_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coaching_survey_adjustments_user_id_created_at_idx" ON "coaching_survey_adjustments" USING btree ("user_id","created_at");