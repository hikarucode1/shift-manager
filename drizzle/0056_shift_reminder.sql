ALTER TYPE "public"."notification_type" ADD VALUE 'shift_reminder';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "shift_reminder_hours" smallint;