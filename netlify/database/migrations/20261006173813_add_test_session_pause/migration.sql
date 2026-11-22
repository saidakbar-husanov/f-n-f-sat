ALTER TABLE "test_attempts" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "remaining_seconds" integer;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "current_question_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "flagged" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "last_saved_at" timestamp;