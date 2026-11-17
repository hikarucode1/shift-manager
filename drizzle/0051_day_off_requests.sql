ALTER TYPE "public"."notification_type" ADD VALUE 'day_off_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'day_off_result';--> statement-breakpoint
CREATE TABLE "day_off_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot_numbers" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "day_off_requests" ADD CONSTRAINT "day_off_requests_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_off_requests" ADD CONSTRAINT "day_off_requests_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "day_off_requests_tutor_date_idx" ON "day_off_requests" USING btree ("tutor_id","date");--> statement-breakpoint
CREATE INDEX "day_off_requests_status_date_idx" ON "day_off_requests" USING btree ("status","date");--> statement-breakpoint
-- #360: server (DB 直結) だけが読み書きする。anon / authenticated に開かない (check:rls)
ALTER TABLE "day_off_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "day_off_requests" FROM anon, authenticated;