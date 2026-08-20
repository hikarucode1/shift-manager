import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRetryableFetchError } from "@supabase/supabase-js";

const signOut = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut } }),
}));

const { POST } = await import("@/app/auth/signout/route");

/** 実際にブラウザが送ってくる形。値が長いとチャンクに割れる (`.0` `.1`) */
const COOKIE_HEADER = [
  "sb-abcdefg-auth-token.0=base64-part1",
  "sb-abcdefg-auth-token.1=part2",
  "sb-abcdefg-auth-token-code-verifier=verifier",
  "sb-abcdefg-auth-token-user=cached-user",
  "theme=dark",
].join("; ");

function signoutRequest() {
  return new Request("https://example.test/auth/signout", {
    method: "POST",
    headers: { cookie: COOKIE_HEADER },
  });
}

/** 失効させられた cookie 名 (max-age=0 で送り返されたもの) */
function expiredCookieNames(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((c) => /Max-Age=0/i.test(c))
    .map((c) => c.split("=")[0]);
}

describe("POST /auth/signout", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    signOut.mockReset();
  });

  it("成功したら cookie に触らず /login へ 303 する", async () => {
    // 成功時は auth-js 自身が cookie を消しているので、こちらは何もしない。
    signOut.mockResolvedValue({ error: null });

    const res = await POST(signoutRequest());

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://example.test/login");
    expect(expiredCookieNames(res)).toEqual([]);
  });

  // --- ここから下が #195 の本体 ---
  // auth-js は signOut がサーバーに届かないと _removeSession() に到達せず、
  // cookie を残したまま { error } を返す。見逃すと共用 PC で次の人が入れる。

  it("失敗したら認証 cookie をすべて失効させる (チャンク / code-verifier / user)", async () => {
    signOut.mockResolvedValue({
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    const res = await POST(signoutRequest());

    expect(expiredCookieNames(res).sort()).toEqual([
      "sb-abcdefg-auth-token-code-verifier",
      "sb-abcdefg-auth-token-user",
      "sb-abcdefg-auth-token.0",
      "sb-abcdefg-auth-token.1",
    ]);
  });

  it("認証と無関係な cookie は消さない", async () => {
    signOut.mockResolvedValue({
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    const res = await POST(signoutRequest());

    expect(expiredCookieNames(res)).not.toContain("theme");
  });

  it("失敗しても /login へ 303 する (利用者には普通のログアウトに見せる)", async () => {
    signOut.mockResolvedValue({
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    const res = await POST(signoutRequest());

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://example.test/login");
  });

  it("サーバー側を解除できなかったことは incident ID でログに残す", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new AuthRetryableFetchError("Failed to fetch", 0);
    signOut.mockResolvedValue({ error });

    await POST(signoutRequest());

    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[signout\] incident=[0-9a-f]{8}$/),
      error,
    );
  });
});
