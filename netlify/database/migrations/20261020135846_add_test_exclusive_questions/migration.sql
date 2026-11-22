ALTER TABLE "questions" ADD COLUMN "scope" text DEFAULT 'BANK' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "source_question_id" integer;--> statement-breakpoint
ALTER TABLE "test_module_questions" ADD COLUMN "source" text DEFAULT 'BANK' NOT NULL;