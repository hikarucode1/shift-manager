import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type User,
} from "@supabase/supabase-js";

const getUser = vi.fn();
const getProfile = vi.fn();
const getUnreadCount = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getProfile,
}));
vi.mock("@/lib/notifications", () => ({ getUnreadCount, markAllRead: vi.fn() }));

const { getUnreadCountAction } = await import(
  "@/app/tutor/notifications/actions"
);

const user = { id: "auth-1" } as User;
const tutor = { id: "p1", isActive: true, roles: ["tutor"] };

describe("getUnreadCountAction", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    [getUser, getProfile, getUnreadCount].forEach((m) => m.mockReset());
  });

  // ⚠️ ここがこの変更の本体。以前は getUser() の error を捨てて 0 を返しており、
  // 認証 API が落ちている間ベルが「未読なし」を出していた (#207)。
  it("認証 API に到達できないときは 0 ではなく ok:false", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    await expect(getUnreadCountAction()).resolves.toEqual({ ok: false });
  });

  it("到達できていて未ログインなら 0 件 (本当に出すものが無い)", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });

    await expect(getUnreadCountAction()).resolves.toEqual({
      ok: true,
      count: 0,
    });
  });

  it("tutor ロールが無ければ 0 件", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue({ ...tutor, roles: ["admin"] });

    await expect(getUnreadCountAction()).resolves.toEqual({
      ok: true,
      count: 0,
    });
  });

  it("取得できたら件数を返す", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue(tutor);
    getUnreadCount.mockResolvedValue(4);

    await expect(getUnreadCountAction()).resolves.toEqual({
      ok: true,
      count: 4,
    });
  });

  it("DB 障害も 0 に潰さず ok:false", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue(tutor);
    getUnreadCount.mockRejectedValue(new Error("relation does not exist"));

    await expect(getUnreadCountAction()).resolves.toEqual({ ok: false });
  });
});
