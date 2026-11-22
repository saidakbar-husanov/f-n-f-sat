CREATE TABLE "test_attempts" (
	"id" serial PRIMARY KEY,
	"test_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"module_index" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '{}' NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	"submitted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "test_module_questions" (
	"id" serial PRIMARY KEY,
	"module_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_modules" (
	"id" serial PRIMARY KEY,
	"test_id" integer NOT NULL,
	"title" text NOT NULL,
	"section" text DEFAULT 'math' NOT NULL,
	"time_limit_minutes" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"time_limit_minutes" integer DEFAULT 134 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now()
);
