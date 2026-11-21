/**
 * 講習希望の「テスト期間」「長期休み」(#319)。教室の「提出シフト」エクセルにある欄。
 * 講師 × 講習期間で 1 件 (training_period_notes の列)。どちらも任意。
 */
export type TrainingRangeKind = "test" | "summer";

export const TRAINING_RANGE_LABEL: Record<TrainingRangeKind, string> = {
  test: "テスト期間",
  summer: "長期休み",
};

export type DateRange = { from: string | null; to: string | null };

/**
 * 保存してよい形か。両方空 (= 消す) か、両方入っていて開始 <= 終了のときだけ OK。
 * 片方だけのときは保存せず、画面で案内する (DB の CHECK も同じ条件)
 */
export function checkDateRange(
  r: DateRange,
): { ok: true } | { ok: false; reason: "partial" | "reversed" } {
  if (r.from === null && r.to === null) return { ok: true };
  if (r.from === null || r.to === null) return { ok: false, reason: "partial" };
  if (r.from > r.to) return { ok: false, reason: "reversed" };
  return { ok: true };
}

/** "2026-12-01" 〜 "2026-12-05" → "12/1〜12/5"。年をまたぐ範囲でも月日だけ出す */
export function formatDateRange(from: string, to: string): string {
  return `${monthDay(from)}〜${monthDay(to)}`;
}

function monthDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}
