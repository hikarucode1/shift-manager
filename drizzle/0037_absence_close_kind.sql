CREATE TYPE "public"."absence_close_kind" AS ENUM('tutor_withdraw', 'admin_cancel', 'unassigned', 'auto_expired', 'expired_unassigned');--> statement-breakpoint
ALTER TABLE "absence_requests" ADD COLUMN "close_kind" "absence_close_kind";--> statement-breakpoint
-- #292: 既存の取り消し済みの行を、decision_note の定型文で埋める。
-- 定型文が一致しても、教室長が取り消し理由にたまたま同じ文を書いた行は
-- admin_cancel にする (PR #290 / #298 で書けなくなる前の行)。見分け方と、
-- 反映後にもう一度流す同じ SQL は docs/runbooks/absence-close-kind.md にある
-- (何度流しても結果は同じ)。
UPDATE "absence_requests" SET "close_kind" = CASE
  -- 本当の自動失効は、PR #235 以降は decided_by を空にし、それより前は
  -- decided_by / decided_at (= 承認したとき) に触らず updated_at だけを進めた。
  -- 教室長の取り消しは decided_by / decided_at / updated_at を同時に書く
  WHEN "decision_note" = '交代成立により自動失効' AND "decided_by" IS NOT NULL
    AND abs(extract(epoch FROM "updated_at" - "decided_at")) < 60 THEN 'admin_cancel'::"absence_close_kind"
  WHEN "decision_note" = '交代成立により自動失効' THEN 'auto_expired'::"absence_close_kind"
  -- 担当でなくなった失効 (#291) は最初から decided_by を空にしている
  WHEN "decision_note" = '担当でなくなったため自動失効' AND "decided_by" IS NOT NULL THEN 'admin_cancel'::"absence_close_kind"
  WHEN "decision_note" = '担当でなくなったため自動失効' THEN 'expired_unassigned'::"absence_close_kind"
  -- 「不要として閉じる」(PR #290、2026-10-05T12:12:14Z マージ) より前には、その経路が無い
  WHEN "decision_note" = '担当変更のため不要' AND "decided_at" < '2026-10-05T12:12:14Z' THEN 'admin_cancel'::"absence_close_kind"
  WHEN "decision_note" = '担当変更のため不要' THEN 'unassigned'::"absence_close_kind"
  WHEN "decision_note" IS NULL AND "decided_by" IS NULL THEN 'tutor_withdraw'::"absence_close_kind"
  ELSE 'admin_cancel'::"absence_close_kind"
END
WHERE "status" = 'cancelled' AND "close_kind" IS NULL;
