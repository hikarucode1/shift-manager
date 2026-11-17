import { describe, expect, it } from "vitest";
import { homeWeekOf, noticeDate, weekOf, weekRangeLabel } from "./week";

describe("weekRangeLabel (#337)", () => {
  it("月〜日の期間を月/日で出す", () => {
    expect(weekRangeLabel({ start: "2026-11-09", end: "2026-11-15" })).toBe("11/9〜11/15");
  });
  it("weekOf は日曜を、今日で終わる週に入れる", () => {
    expect(weekRangeLabel(weekOf("2026-11-15"))).toBe("11/9〜11/15");
  });
});

describe("homeWeekOf (#337)", () => {
  it("日曜は翌日 (月) から始まる週", () => {
    expect(homeWeekOf("2026-11-15")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
  });
  it("月曜と土曜は、今日を含む週", () => {
    expect(homeWeekOf("2026-11-16")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(homeWeekOf("2026-11-21")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
  });
  it("年をまたぐ日曜", () => {
    expect(homeWeekOf("2027-01-03")).toEqual({ start: "2027-01-04", end: "2027-01-10" });
  });
});

describe("noticeDate (通知の本文の日付)", () => {
  it("月/日（曜日）で出す。0 埋めしない", () => {
    expect(noticeDate("2026-11-19")).toBe("11/19（木）");
    expect(noticeDate("2026-01-05")).toBe("1/5（月）");
  });
});
