import { describe, expect, it } from "vitest";
import { checkDateRange, formatDateRange } from "./training-ranges";

describe("checkDateRange", () => {
  it("両方空は OK (消す)", () => {
    expect(checkDateRange({ from: null, to: null })).toEqual({ ok: true });
  });
  it("片方だけは partial", () => {
    expect(checkDateRange({ from: "2026-12-01", to: null })).toEqual({ ok: false, reason: "partial" });
    expect(checkDateRange({ from: null, to: "2026-12-01" })).toEqual({ ok: false, reason: "partial" });
  });
  it("開始が終了より後は reversed、同じ日は OK", () => {
    expect(checkDateRange({ from: "2026-12-05", to: "2026-12-01" })).toEqual({ ok: false, reason: "reversed" });
    expect(checkDateRange({ from: "2026-12-01", to: "2026-12-01" })).toEqual({ ok: true });
  });
});

describe("formatDateRange", () => {
  it("月日だけを出す", () => {
    expect(formatDateRange("2026-12-01", "2027-01-05")).toBe("12/1〜1/5");
  });
});
