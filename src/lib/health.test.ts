import { describe, expect, it, vi } from "vitest";
import { checkHealth } from "./health";

describe("checkHealth", () => {
  it("クエリが通れば 200", async () => {
    expect(await checkHealth(async () => [{ "?column?": 1 }])).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it("クエリが失敗したら 503。詳細は返さない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await checkHealth(async () => {
      throw new Error("connect ECONNREFUSED db.example:5432");
    });
    expect(res).toEqual({ status: 503, body: { ok: false } });
    expect(JSON.stringify(res)).not.toContain("ECONNREFUSED");
  });

  it("時間内に返らなければ 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await checkHealth(() => new Promise(() => {}), 20);
    expect(res.status).toBe(503);
  });
});
