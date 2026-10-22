CREATE TABLE "coach_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"reply" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_replies_kind_check" CHECK ("coach_replies"."kind" in ('activity_comment', 'weekly_note', 'manual_activity'))
);
--> statement-breakpoint
ALTER TABLE "activity_analyses" DROP CONSTRAINT "activity_analyses_activity_id_unique";--> statement-breakpoint
ALTER TABLE "activity_analyses" ADD COLUMN "kind" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_replies" ADD CONSTRAINT "coach_replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_replies_user_id_kind_target_idx" ON "coach_replies" USING btree ("user_id","kind","target");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_analyses_activity_id_kind_idx" ON "activity_analyses" USING btree ("activity_id","kind");