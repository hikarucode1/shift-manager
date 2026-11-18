ALTER TYPE "public"."notification_type" ADD VALUE 'announcement';--> statement-breakpoint
CREATE TABLE "announcement_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "announcement_recipients_announcement_tutor_unique" UNIQUE("announcement_id","tutor_id")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_recipients_tutor_confirmed_idx" ON "announcement_recipients" USING btree ("tutor_id","confirmed_at");--> statement-breakpoint
CREATE INDEX "announcements_created_idx" ON "announcements" USING btree ("created_at");--> statement-breakpoint
-- お知らせ: server (DB 直結) だけが読み書きする。anon / authenticated に開かない (check:rls)
ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "announcements" FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "announcement_recipients" FROM anon, authenticated;
