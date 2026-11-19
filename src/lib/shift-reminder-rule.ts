/**
 * メモ15: 出勤前のリマインド通知の判定 (DB に触らない純粋関数)。
 *
 * 送る側 (/api/cron/shift-reminders) は Supabase pg_cron から 5 分ごとに
 * 呼ばれる。「ちょうど○時間前」だけを狙うと、1 回呼ばれ損ねたときにその日の
 * 通知が丸ごと抜けるので、**○時間前〜開始時刻までの間ならいつでも送る**。
 * 同じ日に 2 回送らないのは notifications の dedupKey (日付) で防ぐ。
 */

/** 講師が選べる「何時間前」 */
export const SHIFT_REMINDER_HOURS = [1, 2, 3] as const;
export type ShiftReminderHours = (typeof SHIFT_REMINDER_HOURS)[number];

/** 入力を検証する。null = 送らない */
export function parseShiftReminderHours(
  v: unknown,
): { ok: true; hours: ShiftReminderHours | null } | { ok: false } {
  if (v === null) return { ok: true, hours: null };
  if (
    typeof v === "number" &&
    (SHIFT_REMINDER_HOURS as readonly number[]).includes(v)
  ) {
    return { ok: true, hours: v as ShiftReminderHours };
  }
  return { ok: false };
}

/** "YYYY-MM-DD" + "HH:MM" (JST) → UTC ms。形が違えば null */
export function jstStartMs(date: string, hm: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(hm)) {
    return null;
  }
  const ms = Date.parse(`${date}T${hm}:00+09:00`);
  return Number.isNaN(ms) ? null : ms;
}

/** 今送るべきか: 開始の hours 時間前 〜 開始時刻 (開始後は送らない) */
export function isReminderDue(input: {
  date: string;
  startTime: string;
  hours: number;
  now: Date;
}): boolean {
  const start = jstStartMs(input.date, input.startTime);
  if (start === null) return false;
  const now = input.now.getTime();
  return now >= start - input.hours * 3_600_000 && now < start;
}

/** その日の最初のコマ (開始時刻が分からないコマは除く) */
export function firstSlotOfDay<T extends { startTime: string }>(
  slots: T[],
): T | null {
  const known = slots.filter((s) => /^\d{2}:\d{2}$/.test(s.startTime));
  if (known.length === 0) return null;
  return known.reduce((a, b) => (b.startTime < a.startTime ? b : a));
}

/** 通知の文面 */
export function reminderMessage(input: {
  startTime: string;
  label: string;
  slotCount: number;
}): { title: string; body: string } {
  return {
    title: `今日は ${input.startTime} から出勤です`,
    body: `${input.label}から、今日は ${input.slotCount} コマです。`,
  };
}
