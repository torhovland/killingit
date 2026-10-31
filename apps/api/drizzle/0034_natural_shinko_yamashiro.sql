ALTER TABLE "llm_models" ADD COLUMN "prompt_price_per_million" double precision;--> statement-breakpoint
ALTER TABLE "llm_models" ADD COLUMN "completion_price_per_million" double precision;--> statement-breakpoint
ALTER TABLE "llm_models" ADD COLUMN "needs_rescore" boolean DEFAULT false NOT NULL;