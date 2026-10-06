import { describe, expect, it } from "vitest";
import { shouldExpireSubstituteAbsence } from "@/lib/absence-expiry";

// 2026-10-11 (日) 12:00 JST = 03:00 UTC
const NOON = new Date("2026-10-11T03:00:00Z");

describe("shouldExpireSubstituteAbsence (#291)", () => {
  it("これから先の日のコマは失効させる", () => {
    expect(shouldExpireSubstituteAbsence("2026-10-12", "10:55", NOON)).toBe(
      true,
    );
    // 先の日なら、終了時刻が分からなくても失効させる
    expect(shouldExpireSubstituteAbsence("2026-10-12", undefined, NOON)).toBe(
      true,
    );
  });

  it("過去の日のコマは失効させない (実際に休んだ記録)", () => {
    expect(shouldExpireSubstituteAbsence("2026-10-10", "21:25", NOON)).toBe(
      false,
    );
  });

  it("今日のコマは、終了時刻で決める", () => {
    // 1 限 (10:55 終了) は終わっている
    expect(shouldExpireSubstituteAbsence("2026-10-11", "10:55", NOON)).toBe(
      false,
    );
    // 3 限 (13:55 終了) はまだ
    expect(shouldExpireSubstituteAbsence("2026-10-11", "13:55", NOON)).toBe(
      true,
    );
    // 終了時刻ちょうどは終わっている (isSlotPast と同じ)
    expect(shouldExpireSubstituteAbsence("2026-10-11", "12:00", NOON)).toBe(
      false,
    );
  });

  it("今日で終了時刻が分からないときは、記録を残す側に倒す", () => {
    expect(shouldExpireSubstituteAbsence("2026-10-11", undefined, NOON)).toBe(
      false,
    );
    expect(shouldExpireSubstituteAbsence("2026-10-11", "", NOON)).toBe(false);
  });
});
