ALTER TABLE "shift_assignments" ADD COLUMN "is_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_shifts" ADD COLUMN "is_training" boolean DEFAULT false NOT NULL;