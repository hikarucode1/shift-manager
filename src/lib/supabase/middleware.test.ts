import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type AuthError,
  type User,
} from "@supabase/supabase-js";

const getUser = vi.fn();

// createServerClient だけ差し替える。cookie の失効に使う parseCookieHeader /
// DEFAULT_COOKIE_OPTIONS は本物を通す (属性が本物と食い違うと意味がない)。
vi.mock("@supabase/ssr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/ssr")>()),
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

const AUTH_COOKIE_NAMES = [
  "sb-abcdefg-auth-token.0",
  "sb-abcdefg-auth-token.1",
  "sb-abcdefg-auth-token-code-verifier",
];

const COOKIE_HEADER = [
  ...AUTH_COOKIE_NAMES.map((name) => `${name}=value-of-${name}`),
  "theme=dark",
].join("; ");

function request(path: string, withCookies = false) {
  return new NextRequest(new URL(path, "https://example.test"), {
    headers: withCookies ? { cookie: COOKIE_HEADER } : undefined,
  });
}

/** 失効させられた cookie 名。判定は Expires (Max-Age は Next のマージで落ちる) */
function expiredCookieNames(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((c) => /Expires=Thu, 01 Jan 1970/i.test(c))
    .map((c) => c.split("=")[0])
    .sort();
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

  it("502-504 (ゲートウェイが落ちている) でも素通しする", async () => {
    resolves({
      user: null,
      error: new AuthRetryableFetchError("service unavailable", 503),
    });

    const res = await updateSession(request("/admin/weekly"));

    expect(res.status).toBe(200);
  });

  it("500 (GoTrue が自分の DB に届かない) でも素通しする", async () => {
    // auth-js の retryable 判定には入らない形。ここが 307 に戻ると、
    // #193 が動機にした障害形がそのまま素通りする。
    resolves({
      user: null,
      error: new AuthApiError("unexpected_failure", 500, "unexpected_failure"),
    });

    const res = await updateSession(request("/admin/weekly"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("401 (JWT 失効) は従来どおり /login へ 307 する", async () => {
    resolves({
      user: null,
      error: new AuthApiError("bad_jwt", 401, "bad_jwt"),
    });

    const res = await updateSession(request("/tutor"));

    expect(res.status).toBe(307);
  });

  it("到達できないことをサーバーログに残す (画面は静かに fallback するので)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new AuthRetryableFetchError("Failed to fetch", 0);
    resolves({ user: null, error });

    await updateSession(request("/tutor"));

    expect(spy).toHaveBeenCalledWith("[middleware] auth unreachable", error);
  });
  // --- ここから下が #197 ---
  // 壊れたチャンク cookie があると @supabase/ssr の base64url デコードが throw し、
  // auth-js の _getUser は AuthError でないものを再 throw する。捕まえないと
  // middleware ごと 500 になり、matcher が全経路に掛かるので /login も
  // /auth/signout も 500 = アプリ側から回復できなくなる。

  function corrupted() {
    getUser.mockRejectedValue(
      new Error('Invalid Base64-URL character "!" at position 20'),
    );
  }

  it("セッションを読めなくても 500 にせず /login へ 307 する", async () => {
    corrupted();

    const res = await updateSession(request("/tutor", true));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://example.test/login");
  });

  it("その 307 に認証 cookie の失効を載せる (次のリクエストで直る)", async () => {
    // 載せ忘れると壊れた cookie を送り続けてリダイレクトループになる。
    corrupted();

    const res = await updateSession(request("/tutor", true));

    expect(expiredCookieNames(res)).toEqual(AUTH_COOKIE_NAMES.slice().sort());
  });

  it("/login では素通ししつつ失効させる (ログイン画面に到達させる)", async () => {
    corrupted();

    const res = await updateSession(request("/login", true));

    expect(res.status).toBe(200);
    expect(expiredCookieNames(res)).toEqual(AUTH_COOKIE_NAMES.slice().sort());
  });

  it("/auth/signout も 500 にしない", async () => {
    corrupted();

    const res = await updateSession(request("/auth/signout", true));

    expect(res.status).toBe(200);
  });

  it("認証と無関係な cookie は消さない", async () => {
    corrupted();

    const res = await updateSession(request("/tutor", true));

    expect(expiredCookieNames(res)).not.toContain("theme");
  });

  it("壊れていないときは失効ヘッダを足さない", async () => {
    resolves({ user, error: null });

    const res = await updateSession(request("/tutor", true));

    expect(expiredCookieNames(res)).toEqual([]);
  });

  it("読めなかったことは incident ID でログに残す", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    corrupted();

    await updateSession(request("/tutor", true));

    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[middleware-auth-cookie\] incident=[0-9a-f]{8}$/,
      ),
      expect.any(Error),
    );
  });
});
