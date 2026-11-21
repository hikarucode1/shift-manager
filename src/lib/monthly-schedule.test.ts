import { describe, expect, it } from "vitest";
import {
  looksLikePdf,
  monthLabel,
  monthStartOf,
  nextMonthOf,
  scheduleNotice,
  schedulePdfPath,
} from "./monthly-schedule";

describe("monthStartOf", () => {
  it("YYYY-MM を月の 1 日にする", () => {
    expect(monthStartOf("2026-12")).toBe("2026-12-01");
  });
  it("形が違う・月が範囲外なら null", () => {
    expect(monthStartOf("2026-13")).toBeNull();
    expect(monthStartOf("2026-1")).toBeNull();
    expect(monthStartOf("../x")).toBeNull();
  });
});

describe("表示", () => {
  it("monthLabel", () => {
    expect(monthLabel("2026-11-01")).toBe("2026年11月");
  });
  it("schedulePdfPath", () => {
    expect(schedulePdfPath("2026-11-01")).toBe("/schedules/2026-11");
  });
  it("初めては「出ました」、上げ直しは「更新されました」", () => {
    expect(scheduleNotice("2026-12-01", false).title).toBe(
      "2026年12月のスケジュールが出ました",
    );
    expect(scheduleNotice("2026-12-01", true).title).toBe(
      "2026年12月のスケジュールが更新されました",
    );
  });
});

describe("looksLikePdf", () => {
  it("%PDF- で始まれば PDF", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("<html>"))).toBe(false);
  });
});

describe("nextMonthOf", () => {
  it("翌月。12 月は翌年 1 月", () => {
    expect(nextMonthOf("2026-11-01")).toBe("2026-12");
    expect(nextMonthOf("2026-12-01")).toBe("2027-01");
  });
});
