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
});
