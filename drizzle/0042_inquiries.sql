CREATE TYPE "public"."inquiry_kind" AS ENUM('question', 'bug', 'request');--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"sender_roles" text[] NOT NULL,
	"kind" "inquiry_kind" NOT NULL,
	"body" text NOT NULL,
	"page_path" text,
	"wants_reply" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_sender_id_profiles_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inquiries_created_idx" ON "inquiries" USING btree ("created_at");--> statement-breakpoint
-- #320: 問い合わせは server action (DB 直結) だけが読み書きする。Supabase の
-- 既定の権限で anon / authenticated に開かないよう閉じる (check:rls)
ALTER TABLE "inquiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "inquiries" FROM anon, authenticated;
