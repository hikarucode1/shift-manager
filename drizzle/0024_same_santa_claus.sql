-- Issue #87: regular_assignments.effective_to を NOT NULL 化
-- 既存 NULL 行は「null = 期末まで」の暗黙の意味論を持っていたので、
-- ALTER 前に period.end_date で backfill して意味を保存する。
-- 本番では事前に違反検出 (`SELECT count(*) FROM regular_assignments WHERE effective_to IS NULL`)
-- で件数を確認してから適用すること。
UPDATE "regular_assignments" AS ra
SET "effective_to" = rsp."end_date"
FROM "regular_shift_periods" AS rsp
WHERE ra."period_id" = rsp."id"
  AND ra."effective_to" IS NULL;--> statement-breakpoint
ALTER TABLE "regular_assignments" DROP CONSTRAINT "regular_assignments_date_range_chk";--> statement-breakpoint
ALTER TABLE "regular_assignments" ALTER COLUMN "effective_to" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "regular_assignments" ADD CONSTRAINT "regular_assignments_date_range_chk" CHECK ("regular_assignments"."effective_from" <= "regular_assignments"."effective_to");
