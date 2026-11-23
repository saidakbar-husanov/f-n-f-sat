CREATE TABLE "learning_placements" (
	"id" serial PRIMARY KEY,
	"class_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"lesson_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"assigned_at" timestamp,
	"due_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "learning_units" (
	"id" serial PRIMARY KEY,
	"class_id" integer NOT NULL,
	"title" text NOT NULL,
	"title_i18n" jsonb DEFAULT '{}' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lesson_materials" (
	"id" serial PRIMARY KEY,
	"lesson_id" integer NOT NULL,
	"kind" text DEFAULT 'download' NOT NULL,
	"title" text NOT NULL,
	"lang" text DEFAULT 'all' NOT NULL,
	"blob_key" text,
	"url" text DEFAULT '' NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"content_type" text DEFAULT '' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"id" serial PRIMARY KEY,
	"student_id" integer NOT NULL,
	"lesson_id" integer NOT NULL,
	"video_position_seconds" integer DEFAULT 0 NOT NULL,
	"video_duration_seconds" integer DEFAULT 0 NOT NULL,
	"video_completed_at" timestamp,
	"completed_at" timestamp,
	"practice_state" jsonb DEFAULT '{}' NOT NULL,
	"last_class_id" integer,
	"last_lang" text DEFAULT '' NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skill_evidence" (
	"id" serial PRIMARY KEY,
	"student_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"skill" text NOT NULL,
	"domain" text DEFAULT '' NOT NULL,
	"section" text DEFAULT '' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"assisted_count" integer DEFAULT 0 NOT NULL,
	"assisted_correct_count" integer DEFAULT 0 NOT NULL,
	"first_independent_at" timestamp,
	"first_independent_correct" boolean,
	"independent_correct_at" timestamp,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"last_selected" text DEFAULT '' NOT NULL,
	"last_correct" boolean DEFAULT false NOT NULL,
	"last_assisted" boolean DEFAULT false NOT NULL,
	"last_attempt_at" timestamp,
	"lesson_id" integer,
	"class_id" integer,
	"lang" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skill_level_ups" (
	"id" serial PRIMARY KEY,
	"student_id" integer NOT NULL,
	"skill" text NOT NULL,
	"level" text NOT NULL,
	"reached_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "owner_class_id" integer;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "source_lesson_id" integer;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "video_provider" text DEFAULT 'youtube' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "video_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "objective" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "content" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "skill_tags" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "practice_question_ids" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "retired_at" timestamp;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "retired_by" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_placements_unit_lesson" ON "learning_placements" ("unit_id","lesson_id");--> statement-breakpoint
CREATE INDEX "learning_placements_class" ON "learning_placements" ("class_id","status");--> statement-breakpoint
CREATE INDEX "learning_placements_lesson" ON "learning_placements" ("lesson_id");--> statement-breakpoint
CREATE INDEX "learning_units_class" ON "learning_units" ("class_id","position");--> statement-breakpoint
CREATE INDEX "lesson_materials_lesson" ON "lesson_materials" ("lesson_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_progress_student_lesson" ON "lesson_progress" ("student_id","lesson_id");--> statement-breakpoint
CREATE INDEX "lesson_progress_lesson" ON "lesson_progress" ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_evidence_student_question" ON "skill_evidence" ("student_id","question_id");--> statement-breakpoint
CREATE INDEX "skill_evidence_student_skill" ON "skill_evidence" ("student_id","skill");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_level_ups_student_skill_level" ON "skill_level_ups" ("student_id","skill","level");