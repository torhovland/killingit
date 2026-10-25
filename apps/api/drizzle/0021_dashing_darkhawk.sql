ALTER TABLE "users" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "location_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_location_check" CHECK (("users"."latitude" is null and "users"."longitude" is null) or ("users"."latitude" is not null and "users"."longitude" is not null));