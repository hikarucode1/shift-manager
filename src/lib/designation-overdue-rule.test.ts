import { describe, expect, it } from "vitest";
import {
  isDesignationOverdue,
  overdueWindow,
} from "./designation-overdue-rule";

// 2026-11-19 10:00 JST
const now = new Date("2026-11-19T01:00:00Z");
const longAgo = new Date("2026-11-15T01:00:00Z");

describe("#331 前日になっても返事が無い指定代講", () => {
  it("対象は今日と明日のコマ (JST)", () => {
    expect(overdueWindow(now)).toEqual({
      from: "2026-11-19",
      to: "2026-11-20",
    });
  });

  it("明日のコマで、依頼から時間がたっていれば対象", () => {
    expect(
      isDesignationOverdue({ date: "2026-11-20", createdAt: longAgo }, now),
    ).toBe(true);
  });

  it("今日のコマも対象 (前日を過ぎてもまだ返事が無い)", () => {
    expect(
      isDesignationOverdue({ date: "2026-11-19", createdAt: longAgo }, now),
    ).toBe(true);
  });

  it("あさって以降のコマはまだ対象外", () => {
    expect(
      isDesignationOverdue({ date: "2026-11-21", createdAt: longAgo }, now),
    ).toBe(false);
  });

  it("過ぎたコマは対象外", () => {
    expect(
      isDesignationOverdue({ date: "2026-11-18", createdAt: longAgo }, now),
    ).toBe(false);
  });

  it("依頼して 3 時間たっていなければ対象外", () => {
    const justNow = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    expect(
      isDesignationOverdue({ date: "2026-11-20", createdAt: justNow }, now),
    ).toBe(false);
  });

  it("JST の日付の境目: 23:30 JST は翌日扱いにしない", () => {
    const lateNight = new Date("2026-11-18T14:30:00Z"); // 11/18 23:30 JST
    expect(overdueWindow(lateNight)).toEqual({
      from: "2026-11-18",
      to: "2026-11-19",
    });
  });
});
