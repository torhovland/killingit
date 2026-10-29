ALTER TABLE "llm_calls" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "llm_calls" SET "completed_at" = "created_at" + ("duration_ms" * interval '1 millisecond');
