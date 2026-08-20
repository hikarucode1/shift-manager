import { describe, expect, it } from "vitest";
import {
  createClient,
  AuthSessionMissingError,
  type AuthError,
  type User,
} from "@supabase/supabase-js";
import {
  AuthUnavailableError,
  getUserOrThrow,
  readAuthUser,
} from "@/lib/auth-availability";

const user = { id: "auth-user-1" } as User;

/**
 * **本物の auth-js を通して分類する**。エラーを自分で `new` すると
 * 「retryable を渡せば到達不能になる」ことしか確かめられず、肝心の
 * 「どの応答が retryable になるか」(auth-js の `handleError`) を迂回してしまう。
 * ここが迂回されていると、ライブラリが `NETWORK_ERROR_CODES` を狭めても
 * CI は緑のままになる。
 *
 * `getUser(jwt)` は jwt を渡すとストレージを経由せず GET /user に直行するので、
 * セッションを用意せずに応答だけ差し替えられる。
 */
function readerFor(respond: () => Promise<Response>) {
  const client = createClient("http://auth.test", "anon-key", {
    global: { fetch: respond },
  });
  return {
    auth: () =>
      readAuthUser({ auth: { getUser: () => client.auth.getUser("jwt") } }),
  };
}

const respondWith =
  (status: number, body: unknown = {}) =>
  async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

/** 認証 API が「答えられなかった」= 到達不能として扱う応答 */
const UNAVAILABLE: [string, () => Promise<Response>][] = [
  [
    "fetch 自体の失敗 (DNS/接続断)",
    async () => {
      throw new TypeError("fetch failed");
    },
  ],
  ["502 Bad Gateway", respondWith(502)],
  ["503 Service Unavailable", respondWith(503)],
  ["504 Gateway Timeout", respondWith(504)],
  // ↓ ここから下は auth-js の retryable 判定に**入らない**。自前で足している分。
  [
    "500 (GoTrue が自分の DB に届かない)",
    respondWith(500, { error_code: "unexpected_failure" }),
  ],
  [
    "429 (レート制限)",
    respondWith(429, { error_code: "over_request_rate_limit" }),
  ],
  [
    "500 + HTML 本文 (ゲートウェイのエラーページ)",
    async () =>
      new Response("<html>Bad Gateway</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      }),
  ],
];

/** 認証 API は答えている = 従来どおり「ログアウト済み」として扱う応答 */
const SIGNED_OUT: [string, () => Promise<Response>][] = [
  ["401 (JWT 失効)", respondWith(401, { error_code: "bad_jwt" })],
  ["403", respondWith(403, { error_code: "forbidden" })],
  [
    "400 (資格情報が誤り)",
    respondWith(400, { error_code: "invalid_credentials" }),
  ],
];

describe("readAuthUser — 本物の auth-js のマッピングを通した分類", () => {
  it("ログイン済みならユーザーを返す", async () => {
    const reader = readerFor(
      async () =>
        new Response(JSON.stringify(user), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await reader.auth()).toEqual({ reachable: true, user });
  });

  it.each(UNAVAILABLE)("到達不能として扱う: %s", async (_label, respond) => {
    const read = await readerFor(respond).auth();
    expect(read.reachable).toBe(false);
  });

  it.each(SIGNED_OUT)(
    "ログアウト済みとして扱う: %s",
    async (_label, respond) => {
      // ここを到達不能に含めると、失効したセッションが /login に飛ばなくなる。
      const read = await readerFor(respond).auth();
      expect(read).toEqual({ reachable: true, user: null });
    },
  );

  it("セッションが無いときはネットワークに出ずに「未ログイン」", async () => {
    // これが崩れると、障害中に未ログインの訪問者まで SystemUnavailable に
    // 落ちて、ログインフォームに到達できなくなる。
    let fetchCalls = 0;
    const client = createClient("http://auth.test", "anon-key", {
      global: {
        fetch: async () => {
          fetchCalls += 1;
          throw new TypeError("fetch failed");
        },
      },
      auth: { persistSession: false, detectSessionInUrl: false },
    });

    const read = await readAuthUser({
      auth: { getUser: () => client.auth.getUser() },
    });

    expect(read).toEqual({ reachable: true, user: null });
    expect(fetchCalls).toBe(0);
  });
});

describe("getUserOrThrow", () => {
  function reader(result: { user: User | null; error: AuthError | null }) {
    return {
      auth: {
        getUser: async () => ({
          data: { user: result.user },
          error: result.error,
        }),
      },
    };
  }

  it("到達不能なら AuthUnavailableError を投げる (cause に元エラーを残す)", async () => {
    const client = createClient("http://auth.test", "anon-key", {
      global: {
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      },
    });
    const failing = { auth: { getUser: () => client.auth.getUser("jwt") } };

    await expect(getUserOrThrow(failing)).rejects.toThrow(AuthUnavailableError);
    await expect(getUserOrThrow(failing)).rejects.toMatchObject({
      cause: { name: "AuthRetryableFetchError" },
    });
  });

  it("未ログインは throw せず null (従来どおり呼び出し側が /login へ送る)", async () => {
    await expect(
      getUserOrThrow(
        reader({ user: null, error: new AuthSessionMissingError() }),
      ),
    ).resolves.toBeNull();
  });

  it("ログイン済みならユーザーを返す", async () => {
    await expect(getUserOrThrow(reader({ user, error: null }))).resolves.toBe(
      user,
    );
  });
});
