export const WEEKDAYS = [
  { key: "mon", label: "月" },
  { key: "tue", label: "火" },
  { key: "wed", label: "水" },
  { key: "thu", label: "木" },
  { key: "fri", label: "金" },
  { key: "sat", label: "土" },
  { key: "sun", label: "日" },
] as const;

export type Weekday = (typeof WEEKDAYS)[number]["key"];

export type InputWeekday = Exclude<Weekday, "sun">;

// 講師レギュラー入力用 (日曜は教室休校のため除外)。Issue #56
export const INPUT_WEEKDAYS = [
  { key: "mon", label: "月" },
  { key: "tue", label: "火" },
  { key: "wed", label: "水" },
  { key: "thu", label: "木" },
  { key: "fri", label: "金" },
  { key: "sat", label: "土" },
] as const satisfies ReadonlyArray<{ key: InputWeekday; label: string }>;

/** 英才個別学院 東武練馬校 の実運用コマ定義 (1限〜8限) */
export const DEFAULT_SLOTS = [
  { slotNumber: 1, label: "1限", startTime: "09:30", endTime: "10:55" },
  { slotNumber: 2, label: "2限", startTime: "11:00", endTime: "12:25" },
  { slotNumber: 3, label: "3限", startTime: "12:30", endTime: "13:55" },
  { slotNumber: 4, label: "4限", startTime: "14:00", endTime: "15:25" },
  { slotNumber: 5, label: "5限", startTime: "15:30", endTime: "16:55" },
  { slotNumber: 6, label: "6限", startTime: "17:00", endTime: "18:25" },
  { slotNumber: 7, label: "7限", startTime: "18:30", endTime: "19:55" },
  { slotNumber: 8, label: "8限", startTime: "20:00", endTime: "21:25" },
] as const;

/** CSV の曜日表記 (漢字1文字) → Weekday key */
export const WEEKDAY_FROM_KANJI: Record<string, Weekday> = {
  月: "mon",
  火: "tue",
  水: "wed",
  木: "thu",
  金: "fri",
  土: "sat",
  日: "sun",
};
