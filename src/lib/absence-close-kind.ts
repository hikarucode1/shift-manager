import type { AbsenceCloseKind } from "@/db/schema";

/**
 * 欠勤申請の閉じ方 (`close_kind`, #292) を、画面が使う 3 つの印にする。
 * 台帳 (`request-log-query.ts`) と講師の履歴 (`absences.ts`) で共有する。
 *
 * ⚠️ 種類は `close_kind` だけで判定する。`decision_note` の文言 (定型文) や
 * `decided_by` の有無を見ないこと。教室長の取り消し理由が定型文と偶然一致
 * すると分類が変わり、`decided_by` は教室長の削除で null になるため (#292)
 */
export function absenceCloseFlags(closeKind: AbsenceCloseKind | null): {
  /** 交代成立で元講師がコマを失い自動失効 (#225 / #250) */
  autoExpired: boolean;
  /** 担当でないため教室長が不要として閉じた (#289) */
  closedUnassigned: boolean;
  /** 代講の取り消しで代講者がコマを失い自動失効 (#291) */
  expiredUnassigned: boolean;
} {
  return {
    autoExpired: closeKind === "auto_expired",
    closedUnassigned: closeKind === "unassigned",
    expiredUnassigned: closeKind === "expired_unassigned",
  };
}
