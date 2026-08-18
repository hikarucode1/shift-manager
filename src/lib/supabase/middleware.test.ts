import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type AuthError,
  type User,
} from "@supabase/supabase-js";

const getUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

const { updateSession } = await import("@/lib/supabase/middleware");

const user = { id: "auth-user-1" } as User;

function resolves(result: { user: User | null; error: AuthError | null }) {
  getUser.mockResolvedValue({
    data: { user: result.user },
    error: result.error,
  });
}

function request(path: string) {
  return new NextRequest(new URL(path, "https://example.test"));
}

describe("updateSession", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    getUser.mockReset();
  });

  it("未ログインなら保護ルートを /login へ 307 する", async () => {
    resolves({ user: null, error: new AuthSessionMissingError() });

    const res = await updateSession(request("/tutor"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://example.test/login");
  });

  it("ログイン済みなら素通しする", async () => {
    resolves({ user, error: null });

    const res = await updateSession(request("/tutor"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  // --- ここから下が #193 の本体 ---
  // これが壊れると、Supabase の pause 中に全員が「ログアウトされた」画面に飛ばされ、
  // #188 の SystemUnavailable に到達できなくなる (障害が「ログアウト」に化ける)。

  it("認証 API に到達できないときは /login へ飛ばさず素通しする", async () => {
    resolves({
      user: null,
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    const res = await updateSession(request("/tutor"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("5xx (pause 中のプロジェクト) でも素通しする", async () => {
    resolves({
      user: null,
      error: new AuthRetryableFetchError("service unavailable", 503),
    });

    const res = await updateSession(request("/admin/weekly"));

    expect(res.status).toBe(200);
  });

  it("到達できないことをサーバーログに残す (画面は静かに fallback するので)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new AuthRetryableFetchError("Failed to fetch", 0);
    resolves({ user: null, error });

    await updateSession(request("/tutor"));

    expect(spy).toHaveBeenCalledWith("[middleware] auth unreachable", error);
  });
});
