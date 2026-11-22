CREATE TABLE "test_highlights" (
	"id" serial PRIMARY KEY,
	"student_id" integer NOT NULL,
	"attempt_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"field" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"quote" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "timed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "practice_scope" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
CREATE INDEX "test_highlights_attempt_question" ON "test_highlights" ("attempt_id","question_id");