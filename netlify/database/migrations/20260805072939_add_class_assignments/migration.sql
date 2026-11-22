CREATE TABLE "assignments" (
	"id" serial PRIMARY KEY,
	"class_id" integer NOT NULL,
	"mentor_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"question_ids" jsonb NOT NULL,
	"due_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
