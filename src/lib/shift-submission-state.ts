/**
 * 固定シフト提出 (fixed_shift_submissions) の状態遷移ルール。
 *
 * DB 側でも同じルールが trigger (`validate_shift_submission_status_transition`)
 * に複製されている。サーバアクションは UPDATE 前にこの関数で検証し、trigger は
 * service_role 直接 SQL / CSV import 等の bypass 経路を最終防御する二重構造。
 *
 * ルール表 (○ = 許可、× = 拒否、 - = 同状態 no-op):
 *
 *   from \ to | draft | submitted | frozen
 *   ----------|-------|-----------|-------
 *   draft     |   -   |     ○     |   ○
 *   submitted |   ○   |     -     |   ○
 *   frozen    |   ○   |     ×     |   -
 *
 * - 同状態への遷移 (status を変えない UPDATE) は許可。メタ列だけ更新するケース。
 * - `frozen → submitted` は禁止。admin が解除する場合は一度 draft に戻し、講師が
 *   再 submit する経路を強制する (運用上「いつの提出か」を曖昧にしないため)。
 */

export type ShiftSubmissionStatus = "draft" | "submitted" | "frozen";

export function isValidStatusTransition(
  from: ShiftSubmissionStatus,
  to: ShiftSubmissionStatus,
): boolean {
  if (from === to) return true;
  if (from === "draft" && (to === "submitted" || to === "frozen")) return true;
  if (from === "submitted" && (to === "draft" || to === "frozen")) return true;
  if (from === "frozen" && to === "draft") return true;
  return false;
}

/**
 * 遷移種別を返す。エラーメッセージや audit ログのキーに使う。
 */
export function classifyTransition(
  from: ShiftSubmissionStatus,
  to: ShiftSubmissionStatus,
):
  | "noop"
  | "submit"
  | "revert"
  | "admin_freeze"
  | "admin_unfreeze"
  | "invalid" {
  if (from === to) return "noop";
  if (from === "draft" && to === "submitted") return "submit";
  if (from === "submitted" && to === "draft") return "revert";
  if (to === "frozen") return "admin_freeze";
  if (from === "frozen" && to === "draft") return "admin_unfreeze";
  return "invalid";
}
