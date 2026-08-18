import {
  isAuthApiError,
  isAuthRetryableFetchError,
  AuthUnknownError,
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
 * 線引きは **「サーバー側の都合で判定できなかった」か「判定した結果、認証を
 * 否定された」か**。前者だけが到達不能で、後者 (401/403/セッション無し) は
 * 従来どおりログアウト扱いにして `/login` へ送る。
 *
 * ⚠️ **判定を書くのはリポジトリ内でこの 1 箇所** (`lib/db-errors.ts` の
 * `pgErrorCode()`、`lib/shell-guard.ts` の `unstable_rethrow` と同じ方針)。
 * クライアント側の `login-form.tsx` もここの `isAuthUnavailable` を使う。
 *
 * ⚠️ **`isAuthRetryableFetchError` だけでは足りない**。auth-js が retryable と
 * するのは fetch 自体の失敗 (status 0) と
 * `NETWORK_ERROR_CODES = [502,503,504,520,521,522,523,524,530]` **だけ**で、
 * **500 も 429 も 540 も `AuthApiError` になる** (`@supabase/auth-js` の
 * `lib/fetch.js`。同ファイルのコメントは "status in 500...599 range" と書いて
 * いるが、実際の配列はこれより狭い — コメントではなく配列を読むこと)。
 * GoTrue は自分の Postgres に届かないとき 500 `unexpected_failure` を返すので、
 * ライブラリの判定だけだと #193 が動機にした障害形が素通りする。
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

/**
 * ライブラリの retryable 判定に含まれないが、意味としては到達不能と同じ側の
 * ステータス。「認証を否定された」のではなく「認証 API が答えられなかった」。
 */
const UNAVAILABLE_STATUS = new Set([
  // GoTrue は自分の Postgres に届かないとき unexpected_failure を 500 で返す。
  // #193 が動機にした「プロジェクトごと止まる」障害の中心的な形。
  500,
  // レート制限。障害復旧直後に講師が一斉に再試行すると同一 NAT IP で当たる。
  // 打ち直しても通らない点は障害と同じなので、ログアウト扱いにはしない。
  429,
]);

/**
 * この error は「認証 API が答えられなかった」ことを示すか。
 * `null` (成功) と、認証を否定する応答 (401/403/セッション無し) では false。
 */
export function isAuthUnavailable(error: unknown): boolean {
  // fetch 自体の失敗 (status 0) と NETWORK_ERROR_CODES
  if (isAuthRetryableFetchError(error)) return true;

  // 本文が JSON でない応答。ゲートウェイが HTML のエラーページを返すと 500 でも
  // ここに来る (実測)。auth-js がこれを作るのはいずれも「何も判定できなかった」
  // 場面だけなので、認証の否定として扱わない。
  if (error instanceof AuthUnknownError) return true;

  return isAuthApiError(error) && UNAVAILABLE_STATUS.has(error.status ?? 0);
}

export async function readAuthUser(client: UserReader): Promise<AuthUserRead> {
  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error && isAuthUnavailable(error)) return { reachable: false, error };

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
