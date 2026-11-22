CREATE TABLE "challenge_sets" (
	"id" serial PRIMARY KEY,
	"external_id" text NOT NULL UNIQUE,
	"section" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "challenge_set_id" integer;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "set_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "questions_bank_import_lookup" ON "questions" ("scope","section","category","external_id");--> statement-breakpoint
CREATE INDEX "questions_challenge_set" ON "questions" ("challenge_set_id","set_position");