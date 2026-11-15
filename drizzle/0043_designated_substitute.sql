ALTER TYPE "public"."swap_close_kind" ADD VALUE 'nominee_declined';--> statement-breakpoint
ALTER TABLE "absence_requests" ADD COLUMN "designated_substitute_id" uuid;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD COLUMN "absence_request_id" uuid;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_designated_substitute_id_profiles_id_fk" FOREIGN KEY ("designated_substitute_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_absence_request_id_absence_requests_id_fk" FOREIGN KEY ("absence_request_id") REFERENCES "public"."absence_requests"("id") ON DELETE set null ON UPDATE no action;