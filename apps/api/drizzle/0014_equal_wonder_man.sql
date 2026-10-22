CREATE TABLE "activity_deletions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"source" text NOT NULL,
	"activity_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_deletions_source_check" CHECK ("activity_deletions"."source" in ('garmin', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "activity_deletions" ADD CONSTRAINT "activity_deletions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_deletions_user_id_source_activity_id_idx" ON "activity_deletions" USING btree ("user_id","source","activity_id");