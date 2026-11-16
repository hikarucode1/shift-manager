CREATE TABLE "shift_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_confirmations_tutor_week_unique" UNIQUE("tutor_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "shift_confirmations" ADD CONSTRAINT "shift_confirmations_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_confirmations_week_idx" ON "shift_confirmations" USING btree ("week_start");--> statement-breakpoint
-- #317: server action (DB 直結) だけが読み書きする。anon / authenticated に開かない (check:rls)
ALTER TABLE "shift_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "shift_confirmations" FROM anon, authenticated;
