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
const markAllRead = vi.fn();
vi.mock("@/lib/notifications", () => ({ getUnreadCount, markAllRead }));

const { getUnreadCountAction, markAllReadAction } = await import(
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
    [getUser, getProfile, getUnreadCount, markAllRead].forEach((m) =>
      m.mockReset(),
    );
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

  it("無効化された講師には件数を返さない (多重防御)", async () => {
    // UI 上は layout の requireRole が先に弾くが、server action は POST
    // エンドポイントとして直接叩けるのでこのガードは実際に効いている。
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue({ ...tutor, isActive: false });

    await expect(getUnreadCountAction()).resolves.toEqual({
      ok: true,
      count: 0,
    });
    expect(getUnreadCount).not.toHaveBeenCalled();
  });

  it("profiles 行が無い (CSV 由来の未連携) なら 0 件", async () => {
    // ガードを落とすと throw → catch → 永久に「!」になるが気づけない。
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue(null);

    await expect(getUnreadCountAction()).resolves.toEqual({
      ok: true,
      count: 0,
    });
  });

  it("DB 障害も 0 に潰さず ok:false", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue(tutor);
    getUnreadCount.mockRejectedValue(new Error("relation does not exist"));

    await expect(getUnreadCountAction()).resolves.toEqual({ ok: false });
  });
});

describe("markAllReadAction", () => {
  // #207 では判別だけ通し、**画面の振る舞いは変えていない**。その主張を固定する
  // (変更した関数なのにテストが 1 件も無く、ガードを外しても緑だった)。
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    [getUser, getProfile, getUnreadCount, markAllRead].forEach((m) =>
      m.mockReset(),
    );
  });

  it("認証 API に到達できないときは既読化を試みない", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    await markAllReadAction();

    expect(markAllRead).not.toHaveBeenCalled();
  });

  it("tutor ロールが無ければ既読化しない", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue({ ...tutor, roles: ["admin"] });

    await markAllReadAction();

    expect(markAllRead).not.toHaveBeenCalled();
  });

  it("本人の未読を既読化する", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue(tutor);

    await markAllReadAction();

    expect(markAllRead).toHaveBeenCalledWith(tutor.id);
  });
});
