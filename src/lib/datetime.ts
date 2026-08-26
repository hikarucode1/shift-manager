/**
 * JST の日時表示 (#233)。
 *
 * 同じ形が `regular-period-manager` / `submission-period-manager` /
 * `submissions-overview` / `weekly-grid` に各自 `fmtDateTime` として複製されて
 * いる。新規はここを使う (既存の 4 箇所の統合は別途)。
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
