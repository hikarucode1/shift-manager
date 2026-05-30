CREATE TABLE "monthly_regular_assignments" (
	"target_month" date NOT NULL,
	"tutor_id" uuid NOT NULL,
	"weekday" "weekday" NOT NULL,
	"slot_number" smallint NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_regular_assignments_target_month_tutor_id_weekday_slot_number_pk" PRIMARY KEY("target_month","tutor_id","weekday","slot_number"),
	CONSTRAINT "monthly_regular_assignments_target_month_first_of_month_chk" CHECK ("monthly_regular_assignments"."target_month" = date_trunc('month', "monthly_regular_assignments"."target_month")::date),
	CONSTRAINT "monthly_regular_assignments_weekday_not_sun_chk" CHECK ("monthly_regular_assignments"."weekday" <> 'sun'),
	CONSTRAINT "monthly_regular_assignments_slot_range_chk" CHECK ("monthly_regular_assignments"."slot_number" BETWEEN 1 AND 20)
);
--> statement-breakpoint
ALTER TABLE "monthly_regular_assignments" ADD CONSTRAINT "monthly_regular_assignments_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_regular_assignments" ADD CONSTRAINT "monthly_regular_assignments_confirmed_by_profiles_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monthly_regular_assignments_tutor_month_idx" ON "monthly_regular_assignments" USING btree ("tutor_id","target_month");--> statement-breakpoint

-- RLS lockdown for the new table (Issue #11 policy, see 0007_rls.sql)
ALTER TABLE "monthly_regular_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "monthly_regular_assignments" FROM anon, authenticated;