CREATE TYPE "public"."shift_availability" AS ENUM('yes', 'maybe', 'no');--> statement-breakpoint
CREATE TABLE "fixed_shift_submissions" (
	"tutor_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"desired_days" smallint,
	"desired_slots" smallint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_shift_submissions_tutor_id_effective_from_pk" PRIMARY KEY("tutor_id","effective_from")
);
--> statement-breakpoint
ALTER TABLE "fixed_shifts" ADD COLUMN "availability" "shift_availability" DEFAULT 'yes' NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_shift_submissions" ADD CONSTRAINT "fixed_shift_submissions_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- RLS lockdown for the new table (Issue #11 policy, see 0007_rls.sql)
ALTER TABLE "fixed_shift_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "fixed_shift_submissions" FROM anon, authenticated;