import { describe, it, expect } from "vitest";
import { parseShiftCsvText, ShiftCsvParseError } from "./shift-csv-parser";

/** ヘッダー + 日ブロックを組み立てる小さなビルダー */
function csv(range: string, dayRows: string[]): string {
  return [`座席表,表示期間,${range}`, "", ...dayRows].join("\n");
}

const oneAssignmentDay = (md: string, weekday: string) => [
  `日付,${md},${weekday}`,
  "1限,09:30〜10:55",
  "座番,講師,生徒,生徒",
  "1,山田太郎,佐藤花子(英)",
];

describe("parseShiftCsvText 年の決定 (#165 H1)", () => {
  it("通常週は weekStart の年を全日に使う", () => {
    const text = csv("2026/04/20〜2026/04/26", [
      ...oneAssignmentDay("4月20日", "月"),
      ...oneAssignmentDay("4月26日", "日"),
    ]);
    const parsed = parseShiftCsvText(text);
    expect(parsed.days.map((d) => d.date)).toEqual([
      "2026-04-20",
      "2026-04-26",
    ]);
  });

  it("年跨ぎ週 (12月→翌1月) は 1月分を翌年にする", () => {
    const text = csv("2026/12/28〜2027/01/03", [
      ...oneAssignmentDay("12月28日", "月"),
      ...oneAssignmentDay("1月1日", "木"),
      ...oneAssignmentDay("1月3日", "土"),
    ]);
    const parsed = parseShiftCsvText(text);
    expect(parsed.days.map((d) => d.date)).toEqual([
      "2026-12-28",
      "2027-01-01",
      "2027-01-03",
    ]);
  });
});

describe("parseShiftCsvText 表示期間の検証 (#165 H2)", () => {
  it("開始 > 終了 は拒否", () => {
    expect(() =>
      parseShiftCsvText(csv("2026/04/26〜2026/04/20", [])),
    ).toThrow(ShiftCsvParseError);
  });

  it("1 週間を超える範囲は拒否 (改竄値での一括削除防止)", () => {
    expect(() =>
      parseShiftCsvText(csv("2026/01/01〜2099/12/31", [])),
    ).toThrow(/1 週間/);
  });

  it("8 日 (差 7) の表示期間も拒否 (隣週の初日を巻き添え削除しない)", () => {
    // 2026/04/20〜2026/04/27 = 8 日間。旧 >7 では通っていたが、we=04-27 は
    // 翌週の公開済み初日なので削除範囲に含めてはいけない。
    expect(() =>
      parseShiftCsvText(csv("2026/04/20〜2026/04/27", [])),
    ).toThrow(/1 週間/);
  });

  it("実在しない表示期間日付 (13月/45日) は NaN すり抜けせず拒否", () => {
    expect(() =>
      parseShiftCsvText(csv("2026/01/01〜2026/13/45", [])),
    ).toThrow(/日付が不正/);
  });

  it("表示期間外の日付を含む CSV は拒否", () => {
    const text = csv("2026/04/20〜2026/04/26", [
      ...oneAssignmentDay("5月1日", "金"),
    ]);
    expect(() => parseShiftCsvText(text)).toThrow(/範囲外/);
  });

  it("ちょうど 1 週間 (月〜日, 差 6) は通る", () => {
    const text = csv("2026/04/20〜2026/04/26", [
      ...oneAssignmentDay("4月20日", "月"),
    ]);
    expect(parseShiftCsvText(text).weekStart).toBe("2026-04-20");
  });
});

describe("parseShiftCsvText 体験・研修 (#335)", () => {
  it("【体験】付きの生徒は isTrial、名前から印は外す", () => {
    const text = csv("2026/11/16〜2026/11/22", [
      "日付,11月18日,水",
      "8限,19:30〜20:55",
      "座番,講師,生徒,生徒",
      "1,山田太郎,【体験】川口花子(数B),佐藤花子(英)",
    ]);
    const a = parseShiftCsvText(text).days[0].slots[0].assignments[0];
    expect(a.isTraining).toBe(false);
    expect(a.students).toEqual([
      expect.objectContaining({ name: "川口花子", isTrial: true }),
      expect.objectContaining({ name: "佐藤花子", isTrial: false }),
    ]);
  });

  it("生徒欄が「研修」の行は生徒 0 人でも研修として残す", () => {
    const text = csv("2026/11/16〜2026/11/22", [
      "日付,11月18日,水",
      "8限,19:30〜20:55",
      "座番,講師,生徒,生徒",
      "1,山田太郎,研修",
      "2,鈴木一郎,",
    ]);
    const assignments = parseShiftCsvText(text).days[0].slots[0].assignments;
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ isTraining: true, students: [] });
  });
});

describe("parseShiftCsvText 全体研修 (#335)", () => {
  it("講師の欄の「全体研修」はコマの印になり、講師としては数えない", () => {
    const text = csv("2026/11/16〜2026/11/22", [
      "日付,11月18日,水",
      "7限,17:50〜19:15",
      "座番,講師,生徒,生徒",
      ",全体研修",
      "8限,19:30〜20:55",
      "座番,講師,生徒,生徒",
      "1,山田太郎,佐藤花子(英)",
    ]);
    const parsed = parseShiftCsvText(text);
    const [s7, s8] = parsed.days[0].slots;
    expect(s7).toMatchObject({ groupTraining: true, assignments: [] });
    expect(s8.groupTraining).toBe(false);
    expect(parsed.uniqueTeacherNames).toEqual(["山田太郎"]);
  });

  it("座番の欄に書いても全体研修になる", () => {
    const text = csv("2026/11/16〜2026/11/22", [
      "日付,11月18日,水",
      "7限,17:50〜19:15",
      "座番,講師,生徒,生徒",
      "全体研修",
    ]);
    expect(parseShiftCsvText(text).days[0].slots[0].groupTraining).toBe(true);
  });
});
