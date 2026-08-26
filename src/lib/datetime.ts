/**
 * JST の日時表示 (#233)。
 *
 * オプションが完全に一致する複製が 3 箇所ある (2026-08-26 時点、実読で確認):
 * `regular-period-manager` の `fmtDateTime` / `submission-period-manager` の
 * `fmtDateTime` / `fixed-shifts/fixed-shift-editor` の `formatSubmittedAt`。
 * 新規はここを使う (既存 3 箇所の統合は別途)。
 *
 * ⚠️ 似ているが**別物**なので混ぜないこと: `submissions-overview` の `fmtJst`
 * は `year` を出さない (`MM/DD HH:mm`)、`weekly-grid` はインラインの
 * `toLocaleString` で `timeZone` 以外のオプションが無い。
 */
export function fmtDateTimeJst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
