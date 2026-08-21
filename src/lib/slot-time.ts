import { jstToday } from "@/lib/week";

/**
 * そのコマが既に終了しているか (#178)。
 *
 * 交代・代講のガードは元々 `date < jstToday()` という**日付粒度**だったため、
 * 「**今朝終わったコマを午後に交代**」が素通りしていた。承認は `weekly_shifts` の
 * 担当を付け替えるので、実施済みコマが事後に書き換わると勤怠・給与の履歴が崩れる。
 *
 * ⚠️ **終了時刻ちょうどは「終了済み」**として扱う (16:30 のコマは 16:30:00 に終了)。
 * ⚠️ DB を触らないので、境界条件はここでテストする。呼び出し側はコマ定義
 * (`getSlotMeta`) から終了時刻を渡す。
 */
export function isSlotPast(
  date: string,
  slotEnd: string,
  now: Date = new Date(),
): boolean {
  const today = jstToday(now);
  if (date < today) return true;
  if (date > today) return false;

  // 同じ日。コマの終了時刻と現在の JST 時刻を突き合わせる
  return slotEnd !== "" && slotEnd <= jstTimeOfDay(now);
}

/** 現在の JST の "HH:MM" (コマ定義の start/end と同じ形式) */
export function jstTimeOfDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}
