ALTER TABLE "training_period_notes" ADD COLUMN "test_from" date;--> statement-breakpoint
ALTER TABLE "training_period_notes" ADD COLUMN "test_to" date;--> statement-breakpoint
ALTER TABLE "training_period_notes" ADD COLUMN "summer_from" date;--> statement-breakpoint
ALTER TABLE "training_period_notes" ADD COLUMN "summer_to" date;--> statement-breakpoint
ALTER TABLE "training_period_notes" ADD CONSTRAINT "training_period_notes_test_range_chk" CHECK (("training_period_notes"."test_from" IS NULL AND "training_period_notes"."test_to" IS NULL)
        OR ("training_period_notes"."test_from" IS NOT NULL AND "training_period_notes"."test_to" IS NOT NULL AND "training_period_notes"."test_from" <= "training_period_notes"."test_to"));--> statement-breakpoint
ALTER TABLE "training_period_notes" ADD CONSTRAINT "training_period_notes_summer_range_chk" CHECK (("training_period_notes"."summer_from" IS NULL AND "training_period_notes"."summer_to" IS NULL)
        OR ("training_period_notes"."summer_from" IS NOT NULL AND "training_period_notes"."summer_to" IS NOT NULL AND "training_period_notes"."summer_from" <= "training_period_notes"."summer_to"));