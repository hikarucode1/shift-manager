import { describe, it, expect } from "vitest";
import {
  ALL_SUBJECT_KEYS,
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
