import { describe, expect, it } from "vitest";
import {
  CHANGE_UNLOCK_MS,
  isGrantActive,
  isGrantExpired,
  pickRegularChangeTarget,
  unlockUntilFrom,
} from "@/lib/shift-change-rule";

const now = new Date("2026-11-17T03:00:00Z");

describe("変更の許可 (#333)", () => {
  it("承認から 3 日間だけ有効", () => {
    const until = unlockUntilFrom(now);
    expect(until.getTime() - now.getTime()).toBe(CHANGE_UNLOCK_MS);
    expect(CHANGE_UNLOCK_MS).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("承認済みで期限内なら有効、期限ちょうども有効", () => {
    const until = unlockUntilFrom(now);
    expect(isGrantActive({ status: "approved", unlockedUntil: until }, now)).toBe(true);
    expect(isGrantActive({ status: "approved", unlockedUntil: until }, until)).toBe(true);
    expect(isGrantExpired({ status: "approved", unlockedUntil: until }, until)).toBe(false);
  });

  it("期限を過ぎたら無効で、閉じる対象", () => {
    const past = new Date(now.getTime() - 1);
    expect(isGrantActive({ status: "approved", unlockedUntil: past }, now)).toBe(false);
    expect(isGrantExpired({ status: "approved", unlockedUntil: past }, now)).toBe(true);
  });

  it("申請中・却下・閉じたものは有効にならない", () => {
    const until = unlockUntilFrom(now);
    for (const status of ["pending", "rejected", "closed"] as const) {
      expect(isGrantActive({ status, unlockedUntil: until }, now)).toBe(false);
      expect(isGrantExpired({ status, unlockedUntil: until }, now)).toBe(false);
    }
  });
});

describe("pickRegularChangeTarget (#333)", () => {
  const p = (id: string, startDate: string, opens: string) => ({
    id,
    startDate,
    submissionOpensAt: new Date(opens),
  });

  it("受付が始まった期のうち、開始日がいちばん新しい期", () => {
    const got = pickRegularChangeTarget(
      [
        p("may", "2026-05-01", "2026-04-01T00:00:00Z"),
        p("oct", "2026-10-01", "2026-09-01T00:00:00Z"),
        // まだ受付が始まっていない来年の期は対象外
        p("next", "2027-05-01", "2027-04-01T00:00:00Z"),
      ],
      now,
    );
    expect(got?.id).toBe("oct");
  });

  it("期が無ければ null (期の無い状態の変更)", () => {
    expect(pickRegularChangeTarget([], now)).toBeNull();
  });
});
