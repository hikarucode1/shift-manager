import {
  isAuthRetryableFetchError,
  type AuthError,
  type User,
} from "@supabase/supabase-js";

/**
 * `getUser()` を「ログイン済み / 未ログイン / 認証 API に到達できない」の 3 値で読む (#193)。
 *
 * auth-js の `_getUser` はネットワーク失敗や 5xx でも **throw しない**。
 * `isAuthError(error)` で拾って `{ data: { user: null }, error }` を return する
 * (`@supabase/auth-js` の `GoTrueClient._getUser` の catch 節)。
 * したがって `error` を捨てて `!user` だけを見ると、**GoTrue に到達できない状態が
 * 「ログアウト済み」と同じ形で観測される**。
 *
 * Supabase を Free tier で使っているのでプロジェクトごと自動 pause されることがあり、
 * そのとき DB と一緒に GoTrue も止まる。捨てていた時代は middleware が全リクエストを
 * `/login` へ 307 していたため、利用者には「ログアウトされた」ようにしか見えず、
 * #188 で入れた SystemUnavailable には**到達しなかった**。
 *
 * ⚠️ **`isAuthRetryableFetchError` を呼ぶのはリポジトリ内でこの 1 箇所**。
 * `error.status === 0 || error.status >= 500` のような自前判定に置き換えないこと
 * (`lib/db-errors.ts` の `pgErrorCode()`、`lib/shell-guard.ts` の `unstable_rethrow`
 * と同じ話で、判定はライブラリ側の関数に委ねる)。
 *
 * ⚠️ 救えるのは auth-js が `AuthRetryableFetchError` を作る 2 経路だけ =
 * **fetch 自体の失敗 (status 0) と HTTP 5xx** (`@supabase/auth-js` の
 * `lib/fetch.js` の `handleError`)。pause したプロジェクトがゲートウェイから
 * 非 5xx (401/404 等) を返す場合は、いまも「ログアウト」として観測される。
 */
export type AuthUserRead =
  | { reachable: true; user: User | null }
  | { reachable: false; error: AuthError };

/**
 * `auth.getUser()` を持つものなら何でも受ける。
 * `createServerClient` の戻り値は型引数が DB スキーマに依存して重いのに対し、
 * ここで要るのは `getUser` だけなので構造で受ける (テストも実体不要になる)。
 */
type UserReader = {
  auth: {
    getUser: () => Promise<{
      data: { user: User | null };
      error: AuthError | null;
    }>;
  };
};

/** 認証 API に到達できないときに投げる。制御フロー例外ではないので
 *  `shell-guard.ts` の `resolveOrIncident` が握り潰して SystemUnavailable になる。 */
export class AuthUnavailableError extends Error {
  constructor(cause: AuthError) {
    super(`認証 API に到達できません: ${cause.message}`, { cause });
    this.name = "AuthUnavailableError";
  }
}

export async function readAuthUser(client: UserReader): Promise<AuthUserRead> {
  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (isAuthRetryableFetchError(error)) return { reachable: false, error };

  // 到達はできている。未ログイン (AuthSessionMissingError) や失効した JWT
  // (AuthApiError 401/403) は従来どおり「ログアウト済み」として扱う。
  return { reachable: true, user };
}

/**
 * `readAuthUser` の throw 版。到達不能を呼び出し側で分岐したくない場所
 * (`requireSession` / `/` / `/login`) で使う。middleware は throw できない
 * ので `readAuthUser` を直接使う。
 */
export async function getUserOrThrow(client: UserReader): Promise<User | null> {
  const read = await readAuthUser(client);
  if (!read.reachable) throw new AuthUnavailableError(read.error);
  return read.user;
}
