ALTER TYPE "public"."notification_type" ADD VALUE 'monthly_schedule';--> statement-breakpoint
CREATE TABLE "monthly_schedules" (
	"month" date PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"content" bytea NOT NULL,
	"byte_size" integer NOT NULL,
	"uploaded_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monthly_schedules" ADD CONSTRAINT "monthly_schedules_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "monthly_schedules" FROM anon, authenticated;
