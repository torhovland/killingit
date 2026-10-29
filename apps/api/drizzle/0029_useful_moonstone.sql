CREATE TABLE "coach_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"question" text NOT NULL,
	"source_kind" text NOT NULL,
	"model" text NOT NULL,
	"answer" text,
	"reply" text,
	"reply_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "coach_questions_question_check" CHECK (length(btrim("coach_questions"."question")) > 0),
	CONSTRAINT "coach_questions_answer_check" CHECK ("coach_questions"."answer" is null or length(btrim("coach_questions"."answer")) > 0),
	CONSTRAINT "coach_questions_reply_check" CHECK ("coach_questions"."reply" is null or length(btrim("coach_questions"."reply")) > 0)
);
--> statement-breakpoint
ALTER TABLE "coach_questions" ADD CONSTRAINT "coach_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_questions_user_id_created_at_idx" ON "coach_questions" USING btree ("user_id","created_at");