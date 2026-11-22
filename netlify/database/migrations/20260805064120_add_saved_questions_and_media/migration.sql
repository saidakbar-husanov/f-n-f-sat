CREATE TABLE "saved_questions" (
	"id" serial PRIMARY KEY,
	"student_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "question_image" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "choice_images" jsonb;