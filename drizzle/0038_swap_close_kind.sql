CREATE TYPE "public"."swap_close_kind" AS ENUM('tutor_withdraw', 'admin_withdraw', 'admin_cancel', 'unassignable');--> statement-breakpoint
ALTER TABLE "swap_requests" ADD COLUMN "close_kind" "swap_close_kind";--> statement-breakpoint
-- #293: 既存の取り消し済みの行を埋める。反映後にもう一度流す同じ SQL が
-- docs/runbooks/swap-close-kind.md にある (何度流しても結果は同じ)。
-- 担当が変わってシステムが閉じた (unassignable) 行は、この PR より前には無い。
UPDATE "swap_requests" SET "close_kind" = CASE
  -- 代講者が決まっていた = 承認済みを教室長が取り消した (記録 #215 の取り消しも含む)
  WHEN "approved_applicant_id" IS NOT NULL THEN 'admin_cancel'::"swap_close_kind"
  -- 教室長の代理募集 (#227) は講師が取り下げられない (cancelSwapRequest が弾く)
  WHEN "created_by" IS NOT NULL AND "created_by" <> "requester_id" THEN 'admin_withdraw'::"swap_close_kind"
  WHEN "decided_by" IS NULL THEN 'tutor_withdraw'::"swap_close_kind"
  ELSE 'admin_withdraw'::"swap_close_kind"
END
WHERE "status" = 'cancelled' AND "close_kind" IS NULL;
