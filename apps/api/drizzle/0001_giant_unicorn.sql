CREATE TABLE "garmin_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"username_encrypted" text NOT NULL,
	"password_encrypted" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
