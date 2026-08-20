import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRetryableFetchError } from "@supabase/supabase-js";

const signOut = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut } }),
}));

const { POST } = await import("@/app/auth/signout/route");

/**
 * 実際に書かれる名前を全種類入れてある: 短いセッションは `storageKey` そのままの
 * 1 本、長いとチャンク (`.0` `.1`) に割れる。`-code-verifier` (PKCE) と
 * `-user` も同じ接頭辞で並ぶ。実運用で 1 本とチャンクが同時に存在することは
 * ないが、名前の判定を全形式で固定するためまとめて入れている。
 */
const AUTH_COOKIE_NAMES = [
  "sb-abcdefg-auth-token",
  "sb-abcdefg-auth-token-code-verifier",
  "sb-abcdefg-auth-token-user",
  "sb-abcdefg-auth-token.0",
  "sb-abcdefg-auth-token.1",
];

const COOKIE_HEADER = [
  ...AUTH_COOKIE_NAMES.map((name) => `${name}=value-of-${name}`),
  "theme=dark",
  "sb-provider-token=keep-me",
].join("; ");

function signoutRequest() {
  return new Request("https://example.test/auth/signout", {
    method: "POST",
    headers: { cookie: COOKIE_HEADER },
  });
}

/**
 * 失効させられた cookie 名。
 *
 * 判定に使うのは `Expires` の方。成功パスでは auth-js も同じ名前を消しに来て
 * 書き込みが 2 つ並び、**Next のマージを通ると `Max-Age=0` が落ちる** (実測)。
 * ここは route を直接呼ぶのでマージが挟まらず両方見えるが、`Max-Age` で判定
 * すると本番でだけ消えない形を緑のまま通してしまう。
 *
 * ⚠️ マージそのものはこのテストでは再現できない。実際にブラウザの cookie jar
 * から消えることは Playwright で別途確認する (PR 本文の実測表)。
 */
function expiredCookieNames(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((c) => /Expires=Thu, 01 Jan 1970/i.test(c))
    .map((c) => c.split("=")[0])
    .sort();
}

describe("POST /auth/signout", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    signOut.mockReset();
  });

  // 不変条件: 押したらブラウザの認証 cookie は必ず消え、/login へ 303 する。
  // signOut() の結果 3 通り (成功 / エラーを返す / reject) すべてで同じ。

  const outcomes: [string, () => void][] = [
    ["成功したとき", () => signOut.mockResolvedValue({ error: null })],
    [
      "サーバー側のログアウトに失敗したとき",
      () =>
        signOut.mockResolvedValue({
          error: new AuthRetryableFetchError("Failed to fetch", 0),
        }),
    ],
    [
      // 壊れたチャンク cookie があると @supabase/ssr の base64url デコードが
      // throw し、_useSession は try/finally なのでそのまま抜けてくる (実測)。
      "signOut() が reject したとき",
      () =>
        signOut.mockRejectedValue(
          new Error('Invalid Base64-URL character "!" at position 20'),
        ),
    ],
  ];

  it.each(outcomes)(
    "%s も認証 cookie をすべて失効させる",
    async (_l, setup) => {
      setup();

      const res = await POST(signoutRequest());

      expect(expiredCookieNames(res)).toEqual(AUTH_COOKIE_NAMES);
    },
  );

  it.each(outcomes)("%s も /login へ 303 する", async (_l, setup) => {
    setup();

    const res = await POST(signoutRequest());

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://example.test/login");
  });

  it("認証と無関係な cookie は消さない", async () => {
    signOut.mockResolvedValue({ error: null });

    const res = await POST(signoutRequest());

    // sb- 始まりでも -auth-token を含まないものは対象外。
    expect(expiredCookieNames(res)).not.toContain("theme");
    expect(expiredCookieNames(res)).not.toContain("sb-provider-token");
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

  it("reject も incident ID でログに残す", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = new Error("boom");
    signOut.mockRejectedValue(thrown);

    await POST(signoutRequest());

    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[signout\] incident=[0-9a-f]{8}$/),
      thrown,
    );
  });

  it("成功したときは incident を記録しない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    signOut.mockResolvedValue({ error: null });

    await POST(signoutRequest());

    expect(spy).not.toHaveBeenCalled();
  });
});
