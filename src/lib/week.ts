/**
 * JST (UTC+9) 基準の週計算ユーティリティ。
 * 「週」は月曜始まり〜日曜終わり。
 * 日付は "YYYY-MM-DD" 文字列で扱う (DB の date 型と揃える / タイムゾーン事故を避ける)。
 *
 * 入力は "YYYY-MM-DD" 形式を前提とし、不正な値は早期に明示エラーで弾く。
 */

import { WEEKDAYS, type Weekday } from "@/lib/shift-constants";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIso(d: string): void {
  if (typeof d !== "string" || !ISO_DATE_RE.test(d)) {
    throw new Error(
      `Invalid date: ${JSON.stringify(d)} (expected "YYYY-MM-DD")`,
    );
  }
}

/** 現在時刻 (UTC) を JST のカレンダー日付 (YYYY-MM-DD) にする */
export function jstToday(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

function parseIso(d: string): Date {
  assertIso(d);
  // 正午 UTC 固定でパースして DST/丸め事故を避ける (日付演算のみに使う)
  return new Date(`${d}T12:00:00.000Z`);
}

function formatIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIso(d);
}

/** dow (0=Sun..6=Sat) → Weekday key */
const WEEKDAY_BY_DOW: readonly Weekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

const LABEL_BY_KEY: Record<Weekday, string> = Object.fromEntries(
  WEEKDAYS.map((w) => [w.key, w.label]),
) as Record<Weekday, string>;

/** ISO 日付 → 曜日 key + 日本語ラベル (1 回の lookup で両方返す) */
export function weekdayOf(iso: string): { key: Weekday; label: string } {
  const key = WEEKDAY_BY_DOW[parseIso(iso).getUTCDay()];
  return { key, label: LABEL_BY_KEY[key] };
}

export type WeekRange = {
  /** 月曜 YYYY-MM-DD */
  start: string;
  /** 日曜 YYYY-MM-DD */
  end: string;
};

/** 指定日 (省略時は JST 今日) を含む月曜〜日曜の週 */
export function weekOf(iso: string = jstToday()): WeekRange {
  const dow = parseIso(iso).getUTCDay(); // 0=Sun..6=Sat
  // 月曜までの戻し日数: Mon=0, Tue=1, ... Sun=6
  const backToMonday = (dow + 6) % 7;
  const start = addDays(iso, -backToMonday);
  const end = addDays(start, 6);
  return { start, end };
}

/** 翌週 */
export function nextWeek(range: WeekRange): WeekRange {
  const start = addDays(range.start, 7);
  return { start, end: addDays(start, 6) };
}

/** 前週 */
export function prevWeek(range: WeekRange): WeekRange {
  const start = addDays(range.start, -7);
  return { start, end: addDays(start, 6) };
}

/** 週の 7 日分の ISO 日付配列 (月→日) */
export function daysOfWeek(range: WeekRange): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(range.start, i));
}

/** "2026-04-20" → "4/20" */
export function shortDate(iso: string): string {
  assertIso(iso);
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
