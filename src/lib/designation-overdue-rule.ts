import { jstToday } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 依頼してすぐに「返事が無い」と出さないための猶予 */
export const MIN_WAIT_MS = 3 * 60 * 60 * 1000;

/** "YYYY-MM-DD" に日数を足す (正午 UTC 基準で丸め事故を避ける) */
function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T12:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * #331 PR 3: 「前日になっても返事が無い」と見なす対象の日付の範囲 (JST)。
 * 今日と明日のコマ。今日のコマは前日を過ぎてもまだ返事が無いもの
 */
export function overdueWindow(now: Date): { from: string; to: string } {
  const today = jstToday(now);
  return { from: today, to: addDays(today, 1) };
}

/**
 * 前日 (JST) 以降になっても返事が無く、依頼から 3 時間以上たっているか。
 * 前日の夜に依頼したばかりのものを、すぐに「返事が無い」としない
 */
export function isDesignationOverdue(
  r: { date: string; createdAt: Date },
  now: Date,
): boolean {
  const { from, to } = overdueWindow(now);
  if (r.date < from || r.date > to) return false;
  return now.getTime() - r.createdAt.getTime() >= MIN_WAIT_MS;
}
