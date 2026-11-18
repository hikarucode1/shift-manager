ALTER TABLE "profiles" ADD COLUMN "track" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "teachable_subjects" text[] DEFAULT '{}' NOT NULL;