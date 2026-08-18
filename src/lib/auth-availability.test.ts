import { describe, expect, it } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type AuthError,
  type User,
} from "@supabase/supabase-js";
import {
  AuthUnavailableError,
  getUserOrThrow,
  readAuthUser,
} from "@/lib/auth-availability";

/**
 * 判定は auth-js の実物のエラークラスで固定する (自作の偽物では意味がない)。
 * `isAuthRetryableFetchError` は `isAuthError(e) && e.name === "AuthRetryableFetchError"`
 * なので、`__isAuthError` を持たないただの Error では通らない。
 */
const user = { id: "auth-user-1" } as User;

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

describe("readAuthUser", () => {
  it("ログイン済みならユーザーを返す", async () => {
    const read = await readAuthUser(reader({ user, error: null }));
    expect(read).toEqual({ reachable: true, user });
  });

  it("セッションが無いだけなら「到達できている・未ログイン」", async () => {
    // Cookie が無いときに auth-js が返すエラー。ネットワークには出ていない。
    const read = await readAuthUser(
      reader({ user: null, error: new AuthSessionMissingError() }),
    );
    expect(read).toEqual({ reachable: true, user: null });
  });

  it("JWT 失効 (401) も「到達できている・未ログイン」のまま", async () => {
    // ここを到達不能に含めると、失効したセッションが /login に飛ばなくなる。
    const read = await readAuthUser(
      reader({
        user: null,
        error: new AuthApiError("invalid claim", 401, "bad_jwt"),
      }),
    );
    expect(read).toEqual({ reachable: true, user: null });
  });

  it("fetch 自体の失敗 (status 0) は到達不能", async () => {
    const error = new AuthRetryableFetchError("Failed to fetch", 0);
    const read = await readAuthUser(reader({ user: null, error }));
    expect(read).toEqual({ reachable: false, error });
  });

  it("5xx も到達不能 (pause 中のプロジェクトはここに来る)", async () => {
    const error = new AuthRetryableFetchError("service unavailable", 503);
    const read = await readAuthUser(reader({ user: null, error }));
    expect(read).toEqual({ reachable: false, error });
  });
});

describe("getUserOrThrow", () => {
  it("到達不能なら AuthUnavailableError を投げる (cause に元エラーを残す)", async () => {
    const error = new AuthRetryableFetchError("Failed to fetch", 0);

    await expect(getUserOrThrow(reader({ user: null, error }))).rejects.toThrow(
      AuthUnavailableError,
    );
    await expect(
      getUserOrThrow(reader({ user: null, error })),
    ).rejects.toMatchObject({ cause: error });
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
