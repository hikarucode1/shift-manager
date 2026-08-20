import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getNotificationHealth = vi.fn();

vi.mock("@/lib/notifications", () => ({ getNotificationHealth }));

const { loadNotificationHealth } = await import(
  "@/lib/notification-health-loader"
);

describe("loadNotificationHealth", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    getNotificationHealth.mockReset();
  });

  // ⚠️ この機能で一番守りたい不変条件。純粋関数 (toHealthView) の中だけで
  // 固定していると、ここを `toHealthView({ recentCount: 0, latestAt: null })` に
  // 書き換えても全テストが緑のまま通り、**壊れているのに 0 件と表示する**という
  // 2026-07-30 の再現を CI が見逃す。
  it("取得に失敗したら 0 件ではなく「取得不可」にする", async () => {
    getNotificationHealth.mockRejectedValue(new Error("relation does not exist"));

    const view = await loadNotificationHealth();

    expect(view.state).toBe("unavailable");
    expect(view.value).not.toBe("0");
  });

  it("失敗時はエラーID を採番して画面とログの両方に出す", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getNotificationHealth.mockRejectedValue(new Error("boom"));

    const view = await loadNotificationHealth();

    const id = view.caption.match(/[0-9a-f]{8}/)?.[0];
    expect(id).toBeTruthy();
    expect(spy).toHaveBeenCalledWith(
      `[admin-notification-health] incident=${id}`,
      expect.any(Error),
    );
  });

  it("取得できたらその値を表示に畳む", async () => {
    getNotificationHealth.mockResolvedValue({
      recentCount: 3,
      latestAt: new Date("2026-08-20T05:30:00Z"),
    });

    const view = await loadNotificationHealth();

    expect(view.state).toBe("ok");
    expect(view.value).toBe("3");
  });

  it("制御フロー例外は握り潰さない (redirect を「取得不可」に化けさせない)", async () => {
    // resolveOrIncident 経由なので unstable_rethrow が効く。素の try/catch に
    // 戻すとここが落ちる。認可の redirect が無言の誤検知になるのを防ぐ。
    const { redirect } = await import("next/navigation");
    let controlFlow: unknown;
    try {
      redirect("/login");
    } catch (e) {
      controlFlow = e;
    }
    getNotificationHealth.mockRejectedValue(controlFlow);

    await expect(loadNotificationHealth()).rejects.toBe(controlFlow);
  });
});
