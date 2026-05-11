CREATE TYPE "public"."period_kind" AS ENUM('normal', 'training');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."swap_kind" AS ENUM('named', 'open');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('tutor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."weekday" AS ENUM('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');--> statement-breakpoint
CREATE TABLE "absence_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot_number" smallint NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_shifts" (
	"tutor_id" uuid NOT NULL,
	"weekday" "weekday" NOT NULL,
	"slot_number" smallint NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_shifts_tutor_id_weekday_slot_number_effective_from_pk" PRIMARY KEY("tutor_id","weekday","slot_number","effective_from")
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "period_kind" NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"submission_deadline" timestamp with time zone,
	"is_reopened" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'tutor' NOT NULL,
	"email" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weekly_shift_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_assignments_position_unique" UNIQUE("weekly_shift_id","position")
);
--> statement-breakpoint
CREATE TABLE "shift_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"week_start" date NOT NULL,
	"week_end" date NOT NULL,
	"storage_path" text,
	"raw_content" text NOT NULL,
	"original_filename" text NOT NULL,
	"file_bytes" integer NOT NULL,
	"parse_meta" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slot_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_number" smallint NOT NULL,
	"label" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_definitions_slot_number_unique" UNIQUE("slot_number")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_name_key_unique" UNIQUE("name_key")
);
--> statement-breakpoint
CREATE TABLE "swap_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swap_request_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"note" text,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swap_applications_unique" UNIQUE("swap_request_id","applicant_id")
);
--> statement-breakpoint
CREATE TABLE "swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"kind" "swap_kind" NOT NULL,
	"nominated_tutor_id" uuid,
	"date" date NOT NULL,
	"slot_number" smallint NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"approved_applicant_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot_number" smallint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_preferences_unique" UNIQUE("period_id","tutor_id","date","slot_number")
);
--> statement-breakpoint
CREATE TABLE "weekly_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot_number" smallint NOT NULL,
	"seat_number" text,
	"is_override" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_shifts_unique" UNIQUE("upload_id","tutor_id","date","slot_number")
);
--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_shifts" ADD CONSTRAINT "fixed_shifts_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_weekly_shift_id_weekly_shifts_id_fk" FOREIGN KEY ("weekly_shift_id") REFERENCES "public"."weekly_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_uploads" ADD CONSTRAINT "shift_uploads_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_applications" ADD CONSTRAINT "swap_applications_swap_request_id_swap_requests_id_fk" FOREIGN KEY ("swap_request_id") REFERENCES "public"."swap_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_applications" ADD CONSTRAINT "swap_applications_applicant_id_profiles_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_requester_id_profiles_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_nominated_tutor_id_profiles_id_fk" FOREIGN KEY ("nominated_tutor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_approved_applicant_id_profiles_id_fk" FOREIGN KEY ("approved_applicant_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_preferences" ADD CONSTRAINT "training_preferences_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_preferences" ADD CONSTRAINT "training_preferences_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_shifts" ADD CONSTRAINT "weekly_shifts_upload_id_shift_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."shift_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_shifts" ADD CONSTRAINT "weekly_shifts_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absence_requests_status_idx" ON "absence_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "absence_requests_tutor_date_idx" ON "absence_requests" USING btree ("tutor_id","date");--> statement-breakpoint
CREATE INDEX "fixed_shifts_tutor_idx" ON "fixed_shifts" USING btree ("tutor_id");--> statement-breakpoint
CREATE INDEX "periods_date_idx" ON "periods" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "shift_assignments_student_idx" ON "shift_assignments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "swap_requests_status_idx" ON "swap_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "swap_requests_date_idx" ON "swap_requests" USING btree ("date","slot_number");--> statement-breakpoint
CREATE INDEX "training_preferences_lookup_idx" ON "training_preferences" USING btree ("period_id","date","slot_number");--> statement-breakpoint
CREATE INDEX "weekly_shifts_date_slot_idx" ON "weekly_shifts" USING btree ("date","slot_number");--> statement-breakpoint
CREATE INDEX "weekly_shifts_tutor_idx" ON "weekly_shifts" USING btree ("tutor_id","date");