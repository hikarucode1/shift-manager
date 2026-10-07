CREATE TYPE "public"."absence_close_kind" AS ENUM('tutor_withdraw', 'admin_cancel', 'unassigned', 'auto_expired', 'expired_unassigned');--> statement-breakpoint
ALTER TABLE "absence_requests" ADD COLUMN "close_kind" "absence_close_kind";--> statement-breakpoint
-- #292: 既存の取り消し済みの行を、それまでの判定式 (decision_note の定型文と
-- decided_by の有無) で埋める。反映後にもう一度流す同じ SQL が
-- docs/runbooks/absence-close-kind.md にある (何度流しても結果は同じ)。
UPDATE "absence_requests" SET "close_kind" = CASE
  WHEN "decision_note" = '交代成立により自動失効' AND "decided_by" IS NULL THEN 'auto_expired'::"absence_close_kind"
  WHEN "decision_note" = '担当でなくなったため自動失効' AND "decided_by" IS NULL THEN 'expired_unassigned'::"absence_close_kind"
  WHEN "decision_note" = '担当変更のため不要' AND "decided_by" IS NOT NULL THEN 'unassigned'::"absence_close_kind"
  WHEN "decision_note" IS NULL AND "decided_by" IS NULL THEN 'tutor_withdraw'::"absence_close_kind"
  ELSE 'admin_cancel'::"absence_close_kind"
END
WHERE "status" = 'cancelled' AND "close_kind" IS NULL;
