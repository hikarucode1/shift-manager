import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRetryableFetchError,
  type User,
} from "@supabase/supabase-js";

const getUser = vi.fn();
const getProfile = vi.fn();
const getUnreadCount = vi.fn();
const markAllRead = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getProfile,
}));
vi.mock("@/lib/notifications", () => ({ getUnreadCount, markAllRead }));

const { getAdminUnreadCountAction, markAllAdminReadAction } = await import(
  "@/app/admin/notifications/actions"
);

const user = { id: "auth-1" } as User;
const admin = { id: "p1", isActive: true, roles: ["admin"] };

// #344: 教室長のベル。講師のベルと同じ作り (#207 の約束も同じ) で、
// 数える・既読にするのは教室長向けの通知だけ
describe("getAdminUnreadCountAction (#344)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    [getUser, getProfile, getUnreadCount, markAllRead].forEach((m) =>
      m.mockReset(),
    );
  });

  it("認証 API に到達できないときは 0 ではなく ok:false", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    await expect(getAdminUnreadCountAction()).resolves.toEqual({ ok: false });
  });

  it("admin ロールが無い (講師だけ) なら 0 件", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue({ ...admin, roles: ["tutor"] });

    await expect(getAdminUnreadCountAction()).resolves.toEqual({
      ok: true,
      count: 0,
    });
    expect(getUnreadCount).not.toHaveBeenCalled();
  });

  it("兼任の人は、教室長向けの通知だけを数える", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue({ ...admin, roles: ["admin", "tutor"] });
    getUnreadCount.mockResolvedValue(2);

    await expect(getAdminUnreadCountAction()).resolves.toEqual({
      ok: true,
      count: 2,
    });
    expect(getUnreadCount).toHaveBeenCalledWith(admin.id, "admin");
  });

  it("DB 障害も 0 に潰さず ok:false", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue(admin);
    getUnreadCount.mockRejectedValue(new Error("column does not exist"));

    await expect(getAdminUnreadCountAction()).resolves.toEqual({ ok: false });
  });
});

describe("markAllAdminReadAction (#344)", () => {
  afterEach(() => {
    [getUser, getProfile, getUnreadCount, markAllRead].forEach((m) =>
      m.mockReset(),
    );
  });

  it("教室長向けの未読だけを既読にする", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue({ ...admin, roles: ["admin", "tutor"] });

    await markAllAdminReadAction();

    expect(markAllRead).toHaveBeenCalledWith(admin.id, "admin");
  });

  it("admin ロールが無ければ既読化しない", async () => {
    getUser.mockResolvedValue({ data: { user }, error: null });
    getProfile.mockResolvedValue({ ...admin, roles: ["tutor"] });

    await markAllAdminReadAction();

    expect(markAllRead).not.toHaveBeenCalled();
  });
});
