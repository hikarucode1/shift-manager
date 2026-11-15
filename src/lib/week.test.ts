import { describe, expect, it } from "vitest";
import { weekOf, weekRangeLabel } from "./week";

describe("weekRangeLabel (#337)", () => {
  it("月〜日の期間を月/日で出す", () => {
    expect(weekRangeLabel({ start: "2026-11-09", end: "2026-11-15" })).toBe("11/9〜11/15");
  });
  it("日曜に開いても、今日で終わる週の期間になる", () => {
    expect(weekRangeLabel(weekOf("2026-11-15"))).toBe("11/9〜11/15");
  });
});
