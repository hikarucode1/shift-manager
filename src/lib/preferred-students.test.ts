import { describe, expect, it } from "vitest";
import {
  formatPreferredStudents,
  normalizePreferredStudents,
  parseStoredPreferredStudents,
  PreferredStudentsInputSchema,
} from "./preferred-students";

describe("normalizePreferredStudents", () => {
  it("前後の空白を落とし、両方空の行だけ捨てる", () => {
    expect(
      normalizePreferredStudents([
        { student: " 山田 ", subject: " 数学" },
        { student: "  ", subject: "" },
        { student: "", subject: "英語" },
        { student: "佐藤", subject: " " },
      ]),
    ).toEqual([
      { student: "山田", subject: "数学" },
      { student: "", subject: "英語" },
      { student: "佐藤", subject: "" },
    ]);
  });
});

describe("parseStoredPreferredStudents", () => {
  it("配列なら読む", () => {
    expect(
      parseStoredPreferredStudents([{ student: "山田", subject: "数学" }]),
    ).toEqual([{ student: "山田", subject: "数学" }]);
  });
  it("形が崩れていたら空にする", () => {
    expect(parseStoredPreferredStudents(null)).toEqual([]);
    expect(parseStoredPreferredStudents({ student: "山田" })).toEqual([]);
    expect(parseStoredPreferredStudents([{ student: 1 }])).toEqual([]);
  });
});

describe("PreferredStudentsInputSchema", () => {
  it("11 行以上は断る", () => {
    const row = { student: "a", subject: "b" };
    expect(PreferredStudentsInputSchema.safeParse(Array(10).fill(row)).success).toBe(true);
    expect(PreferredStudentsInputSchema.safeParse(Array(11).fill(row)).success).toBe(false);
  });
  it("長すぎる生徒名は断る", () => {
    expect(
      PreferredStudentsInputSchema.safeParse([{ student: "あ".repeat(51), subject: "" }]).success,
    ).toBe(false);
  });
});

describe("formatPreferredStudents", () => {
  it("片方だけの行はそのまま出す", () => {
    expect(
      formatPreferredStudents([
        { student: "山田", subject: "数学" },
        { student: "佐藤", subject: "" },
        { student: "", subject: "英語" },
      ]),
    ).toBe("山田（数学）、佐藤、英語");
  });
});
