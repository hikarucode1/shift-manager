import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getNotificationHealth` の `latestAt` が Date で返るか (#315)。
 *
 * drizzle の postgres-js ドライバは timestamp の parser を外しており、DB からは
 * `"2026-10-25 07:26:53.123+00"` のような文字列が返る。列を読むときは列の
 * `mapFromDriverValue` が Date にするが、手書きの sql`max(...)` は通らず、
 * 本番の /admin が `RangeError: Invalid time value` で落ちた。ほかのテストは
 * DB をモックしているので、この変換の段を通らない。
 *
 * ここでは pg-proxy ドライバで**本物の drizzle の結果の変換**を通し、DB の
 * 返す値 (文字列) を差し込む。
 */
const result = vi.hoisted(() => ({ row: [] as unknown[] }));

vi.mock("@/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    db: drizzle(async () => ({ rows: [result.row] })),
  };
});

const { getNotificationHealth } = await import("@/lib/notifications");

beforeEach(() => {
  result.row = [];
});

describe("getNotificationHealth の latestAt (#315)", () => {
  it("DB が文字列で返しても Date になる", async () => {
    // select の順: recentCount, latestAt, dedupKeyProbe, typeProbe
    result.row = [3, "2026-10-25 07:26:53.123+00", 3, 3];
    const health = await getNotificationHealth(7);
    expect(health.latestAt).toBeInstanceOf(Date);
    expect(health.latestAt?.toISOString()).toBe("2026-10-25T07:26:53.123Z");
  });

  it("1 件も無ければ null のまま", async () => {
    result.row = [0, null, 0, 0];
    const health = await getNotificationHealth(7);
    expect(health.latestAt).toBeNull();
  });
});
