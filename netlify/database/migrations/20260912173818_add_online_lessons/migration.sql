CREATE TABLE "lesson_comments" (
	"id" serial PRIMARY KEY,
	"lesson_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"body" text NOT NULL,
	"parent_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"section" text DEFAULT 'math' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"subcategory" text DEFAULT '' NOT NULL,
	"youtube_url" text DEFAULT '' NOT NULL,
	"video_id" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"difficulty" integer DEFAULT 3 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
