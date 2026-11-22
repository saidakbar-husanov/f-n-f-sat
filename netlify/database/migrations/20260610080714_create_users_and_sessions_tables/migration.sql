CREATE TABLE "sessions" (
	"token" text PRIMARY KEY,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"username" text UNIQUE,
	"email" text UNIQUE,
	"phone" text UNIQUE,
	"password_hash" text,
	"provider" text DEFAULT 'password' NOT NULL,
	"provider_id" text,
	"display_name" text DEFAULT 'Student' NOT NULL,
	"role" text DEFAULT 'student' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
