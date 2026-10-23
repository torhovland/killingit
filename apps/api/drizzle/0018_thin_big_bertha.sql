CREATE TABLE "period_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"comment" text,
	"reviewed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_reviews_kind_check" CHECK ("period_reviews"."kind" in ('week', 'block')),
	CONSTRAINT "period_reviews_comment_check" CHECK ("period_reviews"."comment" is null or length(btrim("period_reviews"."comment")) > 0)
);
--> statement-breakpoint
ALTER TABLE "coach_replies" DROP CONSTRAINT "coach_replies_kind_check";--> statement-breakpoint
ALTER TABLE "period_reviews" ADD CONSTRAINT "period_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "period_reviews_user_id_kind_start_date_idx" ON "period_reviews" USING btree ("user_id","kind","start_date");--> statement-breakpoint
ALTER TABLE "coach_replies" ADD CONSTRAINT "coach_replies_kind_check" CHECK ("coach_replies"."kind" in ('activity_comment', 'weekly_note', 'manual_activity', 'week_review', 'block_review'));