import { describe, expect, it } from "vitest";
import { sinceOf } from "@/lib/request-log-query";

describe("sinceOf", () => {
  it("すべては下限なし", () => {
    expect(sinceOf("all", new Date("2026-03-31T10:00:00Z"))).toBeNull();
  });

  it("月末で窓が縮まない (setMonth の日オーバーフロー)", () => {
    // 3/31 の 1 ヶ月前は 2/31 → 3/3 に化ける。窓が 28 日に縮み、
    // 2/28〜3/3 の記録が truncated も立たずに消える
    const since = sinceOf("1m", new Date("2026-03-31T10:00:00Z"))!;
    expect(since.toISOString()).toBe("2026-02-28T10:00:00.000Z");
  });

  it("5/31 の 3 ヶ月前も同じくクランプする", () => {
    // 2/31 → 3/3 になる経路
    const since = sinceOf("3m", new Date("2026-05-31T10:00:00Z"))!;
    expect(since.toISOString()).toBe("2026-02-28T10:00:00.000Z");
  });

  it("日がずれない月は素直に引く", () => {
    expect(sinceOf("1m", new Date("2026-08-26T10:00:00Z"))!.toISOString()).toBe(
      "2026-07-26T10:00:00.000Z",
    );
    expect(sinceOf("3m", new Date("2026-08-26T10:00:00Z"))!.toISOString()).toBe(
      "2026-05-26T10:00:00.000Z",
    );
  });

  it("年をまたぐ", () => {
    expect(sinceOf("3m", new Date("2026-01-15T10:00:00Z"))!.toISOString()).toBe(
      "2025-10-15T10:00:00.000Z",
    );
  });

  it.each([
    { period: "1m", now: "2028-03-31T10:00:00Z", expected: "2028-02-29T10:00:00.000Z", what: "閏年は 2/29 にクランプ" },
    { period: "3m", now: "2028-05-31T10:00:00Z", expected: "2028-02-29T10:00:00.000Z", what: "閏年 (3 ヶ月)" },
    { period: "1m", now: "2028-02-29T10:00:00Z", expected: "2028-01-29T10:00:00.000Z", what: "閏日が起点" },
    { period: "1m", now: "2026-12-31T10:00:00Z", expected: "2026-11-30T10:00:00.000Z", what: "31 日 → 30 日の月" },
    { period: "1m", now: "2026-05-31T10:00:00Z", expected: "2026-04-30T10:00:00.000Z", what: "31 日 → 30 日の月 (5 月)" },
    { period: "3m", now: "2026-03-31T10:00:00Z", expected: "2025-12-31T10:00:00.000Z", what: "年またぎではクランプしない" },
    { period: "1m", now: "2026-01-31T10:00:00Z", expected: "2025-12-31T10:00:00.000Z", what: "年またぎ (1 ヶ月)" },
  ] as const)("$period $now → $expected ($what)", ({ period, now, expected }) => {
    expect(sinceOf(period, new Date(now))!.toISOString()).toBe(expected);
  });

  // ⚠️ 上はどれも JST 19:00 で、UTC と JST の暦が一致する。#279 のずれは
  // JST 0:00〜9:00 (UTC ではまだ前日) にしか出ないので、その時間帯で固定する。
  // テストは vitest.config.ts で UTC (本番と同じ) に固定している。シェルの TZ は
  // 効かない。固定が外れたら src/test/timezone.test.ts が落ちる
  describe("暦は JST で数える (#279)", () => {
    it("JST 3/31 08:00 の 1 ヶ月前は JST 2/28 08:00 (UTC だと 3/30 なので 3/1 にずれていた)", () => {
      expect(sinceOf("1m", new Date("2026-03-30T23:00:00Z"))!.toISOString()).toBe(
        "2026-02-27T23:00:00.000Z",
      );
    });

    it("JST 5/1 05:00 の 1 ヶ月前は JST 4/1 05:00 (UTC だと 4/30 なので 3/31 にずれていた)", () => {
      expect(sinceOf("1m", new Date("2026-04-30T20:00:00Z"))!.toISOString()).toBe(
        "2026-03-31T20:00:00.000Z",
      );
    });
  });
});
