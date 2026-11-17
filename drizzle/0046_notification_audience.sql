ALTER TYPE "public"."notification_type" ADD VALUE 'substitute_response';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "audience" "user_role" DEFAULT 'tutor' NOT NULL;