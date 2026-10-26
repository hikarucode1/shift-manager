import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 手書きの sql`` 式と日付を比べるクエリが、DB に Date をそのまま渡していないか (#313)。
 *
 * drizzle の postgres-js ドライバは timestamp 系の serializer を外している
 * (`drizzle-orm/postgres-js/driver.js`)。列と比べるときは列の側で ISO 文字列に
 * するが、手書きの式と比べると Date のまま postgres-js に渡り、本番で
 * `ERR_INVALID_ARG_TYPE` で落ちた (記録タブと「通知配信」)。ほかのテストは DB を
 * モックしているので、この段を通らない。
 *
 * ここでは**本物の drizzle** でクエリを組み立て、送る直前の params を logger で
 * 取り出す。接続先は存在しないので、送信は失敗する (それでよい)。
 */
const captured = vi.hoisted(() => ({ params: [] as unknown[][] }));

vi.mock("@/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = postgres("postgres://test@127.0.0.1:1/test", {
    prepare: false,
    max: 1,
    connect_timeout: 1,
  });
  return {
    client,
    db: drizzle(client, {
      schema,
      logger: { logQuery: (_q: string, params: unknown[]) => void captured.params.push(params) },
    }),
  };
});

vi.mock("@/lib/slot-meta", () => ({
  getSlotMeta: async () => new Map(),
}));

const { getNotificationHealth } = await import("@/lib/notifications");
const { getRequestLog } = await import("@/lib/request-log-query");
const { client } = (await import("@/db/client")) as unknown as {
  client: { end: () => Promise<void> };
};

afterAll(async () => {
  await client.end().catch(() => {});
});

beforeEach(() => {
  captured.params = [];
});

function dateParams(): unknown[] {
  return captured.params.flat().filter((p) => p instanceof Date);
}

describe("手書きの SQL 式に Date を渡さない (#313)", () => {
  it("通知配信の集計", async () => {
    await getNotificationHealth(7).catch(() => {});
    expect(captured.params.length).toBeGreaterThan(0);
    expect(dateParams()).toEqual([]);
  });

  it("記録タブ (期間あり・欠勤と代講の両方)", async () => {
    await getRequestLog({ period: "1m", type: "all", state: "all" }).catch(() => {});
    expect(captured.params.length).toBe(2);
    expect(dateParams()).toEqual([]);
  });
});
