CREATE TABLE "attempts" (
	"id" serial PRIMARY KEY,
	"student" text NOT NULL,
	"question_id" integer NOT NULL,
	"section" text NOT NULL,
	"category" text NOT NULL,
	"difficulty" integer DEFAULT 3 NOT NULL,
	"mode" text DEFAULT 'bank' NOT NULL,
	"selected" text DEFAULT '' NOT NULL,
	"correct" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"slug" text PRIMARY KEY,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" serial PRIMARY KEY,
	"section" text NOT NULL,
	"category" text NOT NULL,
	"difficulty" integer DEFAULT 3 NOT NULL,
	"type" text DEFAULT 'mcq' NOT NULL,
	"passage" text,
	"prompt" text NOT NULL,
	"choices" jsonb,
	"answer" text NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
