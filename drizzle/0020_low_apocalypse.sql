CREATE TABLE "course_confirmations" (
	"period_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot_number" smallint NOT NULL,
	"tutor_id" uuid NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_confirmations_period_id_date_slot_number_tutor_id_pk" PRIMARY KEY("period_id","date","slot_number","tutor_id"),
	CONSTRAINT "course_confirmations_slot_range_chk" CHECK ("course_confirmations"."slot_number" BETWEEN 1 AND 20)
);
--> statement-breakpoint
ALTER TABLE "course_confirmations" ADD CONSTRAINT "course_confirmations_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_confirmations" ADD CONSTRAINT "course_confirmations_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_confirmations" ADD CONSTRAINT "course_confirmations_confirmed_by_profiles_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_confirmations_period_date_idx" ON "course_confirmations" USING btree ("period_id","date","slot_number");--> statement-breakpoint
CREATE INDEX "course_confirmations_tutor_period_idx" ON "course_confirmations" USING btree ("tutor_id","period_id");--> statement-breakpoint

-- RLS lockdown for the new table (Issue #11 policy, see 0007_rls.sql)
ALTER TABLE "course_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "course_confirmations" FROM anon, authenticated;