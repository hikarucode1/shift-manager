CREATE TABLE "regular_shift_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"submission_opens_at" timestamp with time zone NOT NULL,
	"submission_due_at" timestamp with time zone NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regular_shift_periods_date_range_chk" CHECK ("regular_shift_periods"."start_date" <= "regular_shift_periods"."end_date"),
	CONSTRAINT "regular_shift_periods_opens_before_due_chk" CHECK ("regular_shift_periods"."submission_opens_at" < "regular_shift_periods"."submission_due_at")
);
--> statement-breakpoint
ALTER TABLE "regular_shift_periods" ADD CONSTRAINT "regular_shift_periods_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "regular_shift_periods_active_start_idx" ON "regular_shift_periods" USING btree ("is_archived","start_date");--> statement-breakpoint

-- RLS lockdown for the new table (Issue #11 policy, see 0007_rls.sql)
ALTER TABLE "regular_shift_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "regular_shift_periods" FROM anon, authenticated;