/**
 * 英才個別学院 東武練馬校の「座席表」CSV (Shift_JIS) を解析するモジュール。
 *
 * 前提:
 * - ファイルは CP932/Shift_JIS でエンコードされている
 * - 1週間分 (月〜日) の1つの .csv
 * - 1行 = 1講師 × その日そのコマ (生徒最大2名)
 * - 生徒0名 = その講師はそのコマに出勤しない (解析時に除外)
 * - その日のデータが `座席表未作成` のみ = 休日扱い
 */

import iconv from "iconv-lite";
import { parse as parseCsv } from "csv-parse/sync";
import {
  WEEKDAY_FROM_KANJI,
  type Weekday,
} from "@/lib/shift-constants";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ParsedStudent = {
  name: string;
  subject: string;
};

export type ParsedAssignment = {
  /** 座番。CSV 上 "" の場合 null */
  seatNumber: string | null;
  teacherName: string;
  students: ParsedStudent[]; // 最大2
};

export type ParsedSlot = {
  slotNumber: number;
  label: string; // "1限"
  startTime: string; // "09:30"
  endTime: string; // "10:55"
  assignments: ParsedAssignment[];
};

export type ParsedDay = {
  date: string; // "2026-04-20"
  weekday: Weekday;
  isHoliday: boolean;
  slots: ParsedSlot[];
};

export type ParsedShiftCsv = {
  weekStart: string; // "2026-04-20"
  weekEnd: string; // "2026-04-26"
  activeTrainings: { name: string; startDate: string; endDate: string }[];
  days: ParsedDay[];
  /** 一意な講師名 (名寄せ用) */
  uniqueTeacherNames: string[];
  /** 一意な生徒名 (名寄せ用) */
  uniqueStudentNames: string[];
};

export class ShiftCsvParseError extends Error {
  constructor(
    message: string,
    public readonly rowNumber?: number,
  ) {
    super(message);
    this.name = "ShiftCsvParseError";
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function trimAll(cells: string[]): string[] {
  return cells.map((c) => (c ?? "").trim());
}

/** "09:30〜10:55" → ["09:30", "10:55"]。U+301C (〜) / U+FF5E (～) 両対応 */
function splitTimeRange(src: string): [string, string] | null {
  const m = src.match(/(\d{1,2}:\d{2})\s*[〜～~\-]\s*(\d{1,2}:\d{2})/);
  if (!m) return null;
  return [m[1], m[2]];
}

/** "2026/04/20〜2026/04/26" → ["2026-04-20", "2026-04-26"] */
function splitDateRange(src: string): [string, string] | null {
  const m = src.match(
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*[〜～~\-]\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
  );
  if (!m) return null;
  const pad = (s: string) => s.padStart(2, "0");
  return [
    `${m[1]}-${pad(m[2])}-${pad(m[3])}`,
    `${m[4]}-${pad(m[5])}-${pad(m[6])}`,
  ];
}

/** "4月20日" → { month: 4, day: 20 } */
function parseMonthDay(src: string): { month: number; day: number } | null {
  const m = src.match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return { month: Number(m[1]), day: Number(m[2]) };
}

/** "1限" → 1 */
function parseSlotNumber(src: string): number | null {
  const m = src.match(/^(\d+)限$/);
  if (!m) return null;
  return Number(m[1]);
}

/** "炭田和凛(英)" → { name: "炭田和凛", subject: "英" } / "" → null */
function parseStudentCell(src: string): ParsedStudent | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  // 全角括弧 ()、半角括弧 () どちらも許容
  const m = trimmed.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/);
  if (m) {
    return { name: m[1].trim(), subject: m[2].trim() };
  }
  // 科目が付いていない場合は空文字として保存
  return { name: trimmed, subject: "" };
}

/**
 * 年/月/日 → "YYYY-MM-DD"
 */
function isoDate(year: number, month: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}`;
}

/* ------------------------------------------------------------------ */
/*  Main parser                                                        */
/* ------------------------------------------------------------------ */

export function parseShiftCsvBuffer(buffer: Buffer): ParsedShiftCsv {
  // BOM 付き UTF-8 の場合にも一応対応。デフォルトは Shift_JIS。
  const head = buffer.subarray(0, 3);
  const looksLikeUtf8 =
    head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
  const text = looksLikeUtf8
    ? buffer.slice(3).toString("utf-8")
    : iconv.decode(buffer, "shift_jis");
  return parseShiftCsvText(text);
}

export function parseShiftCsvText(text: string): ParsedShiftCsv {
  const rows: string[][] = parseCsv(text, {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: false,
    trim: false,
  });

  let cursor = 0;
  let weekStart: string | null = null;
  let weekEnd: string | null = null;
  const activeTrainings: ParsedShiftCsv["activeTrainings"] = [];

  // --- ヘッダー ---
  while (cursor < rows.length) {
    const row = trimAll(rows[cursor]);
    if (row.length === 0 || row.every((c) => c === "")) {
      cursor++;
      break; // 空行でヘッダー終了
    }
    const [c0, c1, c2] = row;
    if (c0 === "座席表" && c1 === "表示期間") {
      const rng = splitDateRange(c2 ?? "");
      if (rng) {
        weekStart = rng[0];
        weekEnd = rng[1];
      }
    } else if (c0 === "講習") {
      const rng = splitDateRange(c2 ?? "");
      if (rng) {
        activeTrainings.push({ name: c1 ?? "", startDate: rng[0], endDate: rng[1] });
      }
    }
    cursor++;
  }

  if (!weekStart || !weekEnd) {
    throw new ShiftCsvParseError(
      "ヘッダーから表示期間を読み取れませんでした。1行目に「座席表,表示期間,YYYY/MM/DD〜YYYY/MM/DD」が必要です。",
    );
  }

  const year = Number(weekStart.slice(0, 4));

  // --- 日ブロック ---
  const days: ParsedDay[] = [];
  const teacherSet = new Set<string>();
  const studentSet = new Set<string>();

  while (cursor < rows.length) {
    const row = trimAll(rows[cursor]);

    if (row.every((c) => c === "")) {
      cursor++;
      continue;
    }

    // 日付行: ["日付", "4月20日", "月"]
    if (row[0] === "日付") {
      const md = parseMonthDay(row[1] ?? "");
      const weekdayKey = WEEKDAY_FROM_KANJI[(row[2] ?? "").trim()];
      if (!md) {
        throw new ShiftCsvParseError(
          `日付行の形式が不正: "${rows[cursor].join(",")}"`,
          cursor + 1,
        );
      }
      const date = isoDate(year, md.month, md.day);
      const weekday: Weekday =
        weekdayKey ?? inferWeekdayFromDate(date);
      cursor++;

      // この日の終端までコマを収集
      const { slots, isHoliday, nextCursor } = collectDay(
        rows,
        cursor,
        teacherSet,
        studentSet,
      );
      days.push({ date, weekday, isHoliday, slots });
      cursor = nextCursor;
      continue;
    }

    // 想定外行はスキップ
    cursor++;
  }

  return {
    weekStart,
    weekEnd,
    activeTrainings,
    days,
    uniqueTeacherNames: [...teacherSet].sort(),
    uniqueStudentNames: [...studentSet].sort(),
  };
}

function inferWeekdayFromDate(iso: string): Weekday {
  const d = new Date(iso + "T00:00:00+09:00");
  const idx = d.getUTCDay(); // 0=Sun..6=Sat; JST には時差影響なし(UTC 15:00 = JST 00:00)
  const map: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[idx];
}

/**
 * 次の「日付」行または EOF までを 1 日分として解析する。
 */
function collectDay(
  rows: string[][],
  startCursor: number,
  teacherSet: Set<string>,
  studentSet: Set<string>,
): { slots: ParsedSlot[]; isHoliday: boolean; nextCursor: number } {
  const slots: ParsedSlot[] = [];
  let isHoliday = false;
  let cursor = startCursor;
  let currentSlot: ParsedSlot | null = null;

  while (cursor < rows.length) {
    const row = trimAll(rows[cursor]);

    // 次の日付行に到達 → 終了
    if (row[0] === "日付") break;

    // 完全な空行 → スキップ
    if (row.every((c) => c === "")) {
      cursor++;
      continue;
    }

    const c0 = row[0] ?? "";

    // 休日マーカー
    if (c0 === "座席表未作成") {
      isHoliday = true;
      cursor++;
      continue;
    }

    // コマヘッダー: "1限","09:30〜10:55"
    const slotNum = parseSlotNumber(c0);
    if (slotNum !== null) {
      const range = splitTimeRange(row[1] ?? "");
      currentSlot = {
        slotNumber: slotNum,
        label: `${slotNum}限`,
        startTime: range?.[0] ?? "",
        endTime: range?.[1] ?? "",
        assignments: [],
      };
      slots.push(currentSlot);
      cursor++;
      continue;
    }

    // カラムヘッダー: "座番","講師","生徒","生徒","生徒","生徒"
    if (c0 === "座番") {
      cursor++;
      continue;
    }

    // データ行: c0 = 座番 (数字文字列 or ""), c1 = 講師名, c2..c5 = 生徒
    const teacherName = (row[1] ?? "").trim();
    if (currentSlot && teacherName) {
      const students: ParsedStudent[] = [];
      // 実運用は最大2名だが、保険で 4 カラム見ておく
      for (let i = 2; i <= 5; i++) {
        const s = parseStudentCell(row[i] ?? "");
        if (s) students.push(s);
      }

      // 生徒0名 = その講師はそのコマに出勤しない → スキップ
      if (students.length === 0) {
        cursor++;
        continue;
      }

      // 2名に丸める (超過は無視)
      if (students.length > 2) students.length = 2;

      const seatNumber = c0 === "" ? null : c0;
      currentSlot.assignments.push({
        seatNumber,
        teacherName,
        students,
      });

      teacherSet.add(teacherName);
      for (const s of students) studentSet.add(s.name);
    }

    cursor++;
  }

  return { slots, isHoliday, nextCursor: cursor };
}
