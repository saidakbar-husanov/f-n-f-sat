CREATE TABLE "test_assignments" (
	"id" serial PRIMARY KEY,
	"test_id" integer NOT NULL,
	"assigned_by" integer NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"class_ids" jsonb DEFAULT '[]' NOT NULL,
	"student_ids" jsonb DEFAULT '[]' NOT NULL,
	"all_students" boolean DEFAULT false NOT NULL,
	"module_ids" jsonb DEFAULT '[]' NOT NULL,
	"due_at" timestamp NOT NULL,
	"allow_pause" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "acceptable_answers" jsonb;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "assignment_id" integer;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "module_plan" jsonb;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "allow_pause" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "break_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "score_report" jsonb;--> statement-breakpoint
ALTER TABLE "test_modules" ADD COLUMN "module_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_modules" ADD COLUMN "module_number" integer;--> statement-breakpoint
ALTER TABLE "test_modules" ADD COLUMN "difficulty_track" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "is_adaptive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "break_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "source" text DEFAULT 'builder' NOT NULL;