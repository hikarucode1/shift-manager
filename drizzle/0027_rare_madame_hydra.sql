-- #110: periods.kind を撤廃し、全期間を講習期間に一本化する。
-- 既存の kind='normal' 行は廃止対象 (専用フローが無く子レコードも持たない想定)。
-- 列削除後は kind で絞れないため、DROP COLUMN の前に normal 行を削除する。
-- ※ normal 行が子 (course_confirmations / training_preferences / training_period_notes)
--   を持つ場合は FK (onDelete restrict) で失敗する。本番は子 0 件を事前確認済み。
DELETE FROM "periods" WHERE "kind" = 'normal';--> statement-breakpoint
ALTER TABLE "periods" DROP COLUMN "kind";--> statement-breakpoint
DROP TYPE "public"."period_kind";
