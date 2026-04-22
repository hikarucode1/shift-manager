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

/** 初期コマ定義。実運用の時間帯は slot_definitions テーブルで上書き可能 */
export const DEFAULT_SLOTS = [
  { slotNumber: 1, label: "1限", startTime: "13:50", endTime: "15:20" },
  { slotNumber: 2, label: "2限", startTime: "15:30", endTime: "17:00" },
  { slotNumber: 3, label: "3限", startTime: "17:10", endTime: "18:40" },
  { slotNumber: 4, label: "4限", startTime: "18:50", endTime: "20:20" },
  { slotNumber: 5, label: "5限", startTime: "20:30", endTime: "22:00" },
] as const;
