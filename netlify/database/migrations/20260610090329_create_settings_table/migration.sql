CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" jsonb,
	"updated_at" timestamp DEFAULT now()
);
