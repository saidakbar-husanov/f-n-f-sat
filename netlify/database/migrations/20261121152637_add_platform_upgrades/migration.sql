CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY,
	"actor_id" integer,
	"action" text NOT NULL,
	"target_type" text DEFAULT '' NOT NULL,
	"target_id" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "badge_awards" (
	"id" serial PRIMARY KEY,
	"student_id" integer NOT NULL,
	"badge_key" text NOT NULL,
	"meta" jsonb DEFAULT '{}' NOT NULL,
	"awarded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exam_integrity_events" (
	"id" serial PRIMARY KEY,
	"attempt_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"duration_ms" integer,
	"occurrence" integer DEFAULT 1 NOT NULL,
	"counted" boolean DEFAULT false NOT NULL,
	"module_index" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY,
	"sender_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "module_completions" (
	"id" serial PRIMARY KEY,
	"attempt_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"module_index" integer NOT NULL,
	"completed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "question_reports" (
	"id" serial PRIMARY KEY,
	"question_id" integer NOT NULL,
	"reporter_id" integer NOT NULL,
	"reason" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'bank' NOT NULL,
	"test_attempt_id" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"resolution_note" text DEFAULT '' NOT NULL,
	"resolved_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student_daily_activity" (
	"id" serial PRIMARY KEY,
	"student_id" integer NOT NULL,
	"day" date NOT NULL,
	"practice_answered" integer DEFAULT 0 NOT NULL,
	"bank_used" integer DEFAULT 0 NOT NULL,
	"challenge_used" integer DEFAULT 0 NOT NULL,
	"mock_starts" integer DEFAULT 0 NOT NULL,
	"modules_completed" integer DEFAULT 0 NOT NULL,
	"vocab_quizzes" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage_limits" (
	"id" serial PRIMARY KEY,
	"scope" text NOT NULL,
	"target_id" integer NOT NULL,
	"limits" jsonb DEFAULT '{}' NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "exam_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "integrity_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "violation_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "warning_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "integrity_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "integrity_reviewed_by" integer;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "integrity_reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "competition_excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferences" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "vocab_words" ADD COLUMN "russian_translation" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "attempts_student_created" ON "attempts" ("student","created_at");--> statement-breakpoint
CREATE INDEX "attempts_created" ON "attempts" ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created" ON "audit_log" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "badge_awards_student_badge" ON "badge_awards" ("student_id","badge_key");--> statement-breakpoint
CREATE INDEX "exam_integrity_events_attempt" ON "exam_integrity_events" ("attempt_id","occurred_at");--> statement-breakpoint
CREATE INDEX "messages_pair" ON "messages" ("sender_id","recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_recipient_unread" ON "messages" ("recipient_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "module_completions_attempt_module" ON "module_completions" ("attempt_id","module_index");--> statement-breakpoint
CREATE INDEX "notifications_user_read" ON "notifications" ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "question_reports_question" ON "question_reports" ("question_id");--> statement-breakpoint
CREATE INDEX "question_reports_status" ON "question_reports" ("status","created_at");--> statement-breakpoint
CREATE INDEX "question_reports_reporter" ON "question_reports" ("reporter_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "student_daily_activity_student_day" ON "student_daily_activity" ("student_id","day");--> statement-breakpoint
CREATE INDEX "student_daily_activity_day" ON "student_daily_activity" ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_limits_scope_target" ON "usage_limits" ("scope","target_id");--> statement-breakpoint
-- Backfill per-day activity from existing history (platform timezone defaults to UTC).
-- Nothing existing is modified; this only seeds the new summary table.
INSERT INTO "student_daily_activity" ("student_id", "day", "practice_answered", "bank_used", "challenge_used")
SELECT substring("student" from 2)::int, ("created_at")::date,
  count(*) FILTER (WHERE "mode" IN ('bank','rush','challenge','review') OR "mode" LIKE 'task:%'),
  count(*) FILTER (WHERE "mode" IN ('bank','rush')),
  count(*) FILTER (WHERE "mode" = 'challenge')
FROM "attempts"
WHERE "student" ~ '^u[0-9]{1,9}$' AND "created_at" IS NOT NULL
GROUP BY 1, 2
ON CONFLICT ("student_id", "day") DO NOTHING;
--> statement-breakpoint
INSERT INTO "student_daily_activity" ("student_id", "day", "mock_starts")
SELECT "student_id", ("started_at")::date, count(*) FILTER (WHERE "assignment_id" IS NULL)
FROM "test_attempts" WHERE "started_at" IS NOT NULL
GROUP BY 1, 2
ON CONFLICT ("student_id", "day") DO UPDATE SET "mock_starts" = EXCLUDED."mock_starts";
--> statement-breakpoint
-- A submitted sitting finished every module up to the one it closed on.
INSERT INTO "module_completions" ("attempt_id", "student_id", "module_index", "completed_at")
SELECT "id", "student_id", "module_index", "submitted_at" FROM "test_attempts" WHERE "submitted_at" IS NOT NULL
ON CONFLICT ("attempt_id", "module_index") DO NOTHING;
--> statement-breakpoint
INSERT INTO "student_daily_activity" ("student_id", "day", "modules_completed")
SELECT "student_id", ("completed_at")::date, count(*) FROM "module_completions" WHERE "completed_at" IS NOT NULL
GROUP BY 1, 2
ON CONFLICT ("student_id", "day") DO UPDATE SET "modules_completed" = EXCLUDED."modules_completed";
