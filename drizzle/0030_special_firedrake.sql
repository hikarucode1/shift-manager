ALTER TABLE "notifications" ADD COLUMN "dedup_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedup_uniq" ON "notifications" USING btree ("recipient_id","type","dedup_key");