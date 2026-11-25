CREATE TABLE "access_rules" (
	"id" serial PRIMARY KEY,
	"scope" text NOT NULL,
	"target_id" integer NOT NULL,
	"preset" text DEFAULT 'custom' NOT NULL,
	"rules" jsonb DEFAULT '{}' NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"class_ids" jsonb DEFAULT '[]' NOT NULL,
	"author_id" integer NOT NULL,
	"client_key" text,
	"published_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "library_articles" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"question" jsonb,
	"created_by" integer,
	"updated_by" integer,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" serial PRIMARY KEY,
	"student_id" integer NOT NULL,
	"kind" text DEFAULT 'bank' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"filters" jsonb DEFAULT '{}' NOT NULL,
	"challenge_set_id" integer,
	"question_ids" jsonb DEFAULT '[]' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '{}' NOT NULL,
	"flagged" jsonb DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"client_key" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "leaderboard_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "previous_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "access_rules_scope_target" ON "access_rules" ("scope","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcements_author_client_key" ON "announcements" ("author_id","client_key");--> statement-breakpoint
CREATE INDEX "announcements_published" ON "announcements" ("published_at");--> statement-breakpoint
CREATE INDEX "library_articles_status" ON "library_articles" ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe" ON "notifications" ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "practice_sessions_student" ON "practice_sessions" ("student_id","kind","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_sessions_client_key" ON "practice_sessions" ("student_id","client_key");