import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { sendNotification } }));

// db.select().from().where() と db.delete().where() だけを真似る
const subs: { id: string; endpoint: string; p256dh: string; auth: string }[] =
  [];
const deleted: unknown[] = [];
vi.mock("@/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => subs }) }),
    delete: () => ({
      where: async (cond: unknown) => {
        deleted.push(cond);
      },
    }),
  },
}));

const { sendPushToProfiles, isGoneStatus } = await import("@/lib/web-push");

describe("sendPushToProfiles (#318)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    subs.splice(0, subs.length, {
      id: "s1",
      endpoint: "https://push.example/1",
      p256dh: "k",
      auth: "a",
    });
    deleted.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sendNotification.mockReset();
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it("鍵が未設定なら何も送らない", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    await sendPushToProfiles(["p1"], { title: "t" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("宛先の端末に title / body / href を送る", async () => {
    await sendPushToProfiles(["p1"], { title: "t", body: "b", href: "/x" });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [sub, payload] = sendNotification.mock.calls[0];
    expect(sub).toEqual({
      endpoint: "https://push.example/1",
      keys: { p256dh: "k", auth: "a" },
    });
    expect(JSON.parse(payload)).toEqual({ title: "t", body: "b", href: "/x" });
    expect(deleted).toHaveLength(0);
  });

  it("410 (期限切れ) の端末は消す", async () => {
    sendNotification.mockRejectedValue({ statusCode: 410 });
    await sendPushToProfiles(["p1"], { title: "t" });
    expect(deleted).toHaveLength(1);
  });

  it("それ以外の失敗は消さず、throw もしない", async () => {
    sendNotification.mockRejectedValue({ statusCode: 500 });
    await expect(
      sendPushToProfiles(["p1"], { title: "t" }),
    ).resolves.toBeUndefined();
    expect(deleted).toHaveLength(0);
  });

  it("isGoneStatus は 404 / 410 だけ", () => {
    expect([404, 410, 400, 429, 500, undefined].map(isGoneStatus)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});
