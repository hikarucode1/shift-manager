CREATE TYPE "public"."shift_change_kind" AS ENUM('regular', 'training');--> statement-breakpoint
CREATE TYPE "public"."shift_change_status" AS ENUM('pending', 'approved', 'rejected', 'closed');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shift_change_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shift_change_result';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shift_change_done';--> statement-breakpoint
CREATE TABLE "shift_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"kind" "shift_change_kind" NOT NULL,
	"regular_period_id" uuid,
	"training_period_id" uuid,
	"reason" text NOT NULL,
	"status" "shift_change_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"unlocked_until" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_change_requests_kind_target" CHECK (("shift_change_requests"."kind" = 'regular' and "shift_change_requests"."training_period_id" is null) or ("shift_change_requests"."kind" = 'training' and "shift_change_requests"."training_period_id" is not null and "shift_change_requests"."regular_period_id" is null))
);
--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_regular_period_id_regular_shift_periods_id_fk" FOREIGN KEY ("regular_period_id") REFERENCES "public"."regular_shift_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_training_period_id_periods_id_fk" FOREIGN KEY ("training_period_id") REFERENCES "public"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_change_requests" ADD CONSTRAINT "shift_change_requests_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_change_requests_active_regular_uniq" ON "shift_change_requests" USING btree ("tutor_id") WHERE "shift_change_requests"."kind" = 'regular' and "shift_change_requests"."status" in ('pending','approved');--> statement-breakpoint
CREATE UNIQUE INDEX "shift_change_requests_active_training_uniq" ON "shift_change_requests" USING btree ("tutor_id","training_period_id") WHERE "shift_change_requests"."kind" = 'training' and "shift_change_requests"."status" in ('pending','approved');--> statement-breakpoint
CREATE INDEX "shift_change_requests_status_idx" ON "shift_change_requests" USING btree ("status","created_at");--> statement-breakpoint
-- #333: server (DB 直結) だけが読み書きする。anon / authenticated に開かない (check:rls)
ALTER TABLE "shift_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "shift_change_requests" FROM anon, authenticated;
