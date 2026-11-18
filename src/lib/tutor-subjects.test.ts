import { describe, it, expect } from "vitest";
import {
  ALL_SUBJECT_KEYS,
  checkTeachingProfile,
  matchesTrackFilter,
  normalizeSubjects,
  subjectShortLabel,
  trackLabel,
} from "./tutor-subjects";

describe("tutor-subjects (#348)", () => {
  it("key は重複しない", () => {
    expect(new Set(ALL_SUBJECT_KEYS).size).toBe(ALL_SUBJECT_KEYS.length);
  });

  it("normalizeSubjects は選択肢の順にそろえ、重複と知らない key を落とす", () => {
    expect(normalizeSubjects(["hs_phys", "jh_en", "x", "hs_phys"])).toEqual([
      "jh_en",
      "hs_phys",
    ]);
  });

  it("短い表示名は中・高を付ける", () => {
    expect(subjectShortLabel("jh_math")).toBe("中数");
    expect(subjectShortLabel("hs_stats")).toBe("高統計（数B）");
    expect(trackLabel("both")).toBe("どちらも");
    expect(trackLabel(null)).toBeNull();
  });
});

describe("checkTeachingProfile (#348 / #349 共通)", () => {
  it("文理と科目があれば通し、科目は選択肢の順にそろえる", () => {
    expect(
      checkTeachingProfile({ track: "science", subjects: ["hs_phys", "jh_math"] }),
    ).toEqual({ ok: true, track: "science", subjects: ["jh_math", "hs_phys"] });
  });

  it("文理が無い・科目が空なら、直し方を伝える", () => {
    expect(checkTeachingProfile({ track: null, subjects: ["jh_en"] })).toEqual({
      ok: false,
      error: "理系・文系を選んでください。",
    });
    expect(checkTeachingProfile({ track: "both", subjects: [] })).toEqual({
      ok: false,
      error: "担当できる科目を 1 つ以上選んでください。",
    });
  });

  it("知らない文理・科目や形の違う入力は弾く", () => {
    for (const input of [
      { track: "art", subjects: ["jh_en"] },
      { track: "science", subjects: ["jh_en", "x"] },
      { track: "science", subjects: "jh_en" },
      { track: "science", subjects: [1] },
      {},
    ]) {
      expect(checkTeachingProfile(input)).toEqual({
        ok: false,
        error: "入力が不正です。",
      });
    }
  });
});

describe("matchesTrackFilter (#349)", () => {
  it("理系・文系には「どちらも」の人も入る", () => {
    expect(matchesTrackFilter("science", "science")).toBe(true);
    expect(matchesTrackFilter("both", "science")).toBe(true);
    expect(matchesTrackFilter("humanities", "science")).toBe(false);
    expect(matchesTrackFilter("both", "humanities")).toBe(true);
  });

  it("「どちらも」は「どちらも」の人だけ、「未登録」は文理が無い人だけ", () => {
    expect(matchesTrackFilter("science", "both")).toBe(false);
    expect(matchesTrackFilter("both", "both")).toBe(true);
    expect(matchesTrackFilter(null, "none")).toBe(true);
    expect(matchesTrackFilter("science", "none")).toBe(false);
    expect(matchesTrackFilter(null, null)).toBe(true);
  });
});
