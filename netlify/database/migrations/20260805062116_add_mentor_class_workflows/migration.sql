CREATE TABLE "class_enrollments" (
	"id" serial PRIMARY KEY,
	"class_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "class_invites" (
	"id" serial PRIMARY KEY,
	"class_id" integer NOT NULL,
	"code_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp NOT NULL,
	"used_by" integer,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" serial PRIMARY KEY,
	"mentor_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mentor_activation_codes" (
	"id" serial PRIMARY KEY,
	"code_hash" text NOT NULL UNIQUE,
	"mentor_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_at" timestamp;