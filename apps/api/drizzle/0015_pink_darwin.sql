CREATE TABLE "activity_feed_cache" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"feed" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_feed_cache" ADD CONSTRAINT "activity_feed_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;