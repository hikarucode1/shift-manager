import { DEFAULT_COOKIE_OPTIONS, parseCookieHeader } from "@supabase/ssr";
import type { NextResponse } from "next/server";

/**
 * Supabase の認証 cookie。`sb-<project-ref>-auth-token` を基点に、
 * 長い値のチャンク (`.0` `.1` ...) と `-code-verifier` / `-user` が並ぶ
 * (auth-js が消しているのもこの 3 種)。
 *
 * project-ref を含むので名前を決め打ちできず、storageKey は auth-js 側で
 * `protected` なので型からも触れない。ここでは命名規約だけで拾う。
 *
 * ⚠️ **`-code-verifier` (PKCE) も対象に入る**。middleware (#197) は
 * `/auth/*` の素通し時にもこれを呼ぶので、将来 `/auth/callback` や
 * パスワード再設定の route を足すなら要注意: コールバック時点で壊れた chunk が
 * 残っていると、直前に書かれた verifier まで巻き添えで消え、コード交換が
 * 失敗する。現状 `/auth/` 配下は signout だけで、`exchangeCodeForSession` /
 * `signInWithOAuth` / `signInWithOtp` / `resetPasswordForEmail` は未使用。
 *
 * ⚠️ 削除は `path=/` 決め打ち。`@supabase/ssr` は
 * `{...DEFAULT_COOKIE_OPTIONS, ...cookieOptions}` で書くので、将来
 * `createClient()` に `cookieOptions` を渡すならここも合わせること
 * (path が食い違うと消したつもりで残る)。
 */
export function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

/**
 * リクエストが持っている認証 cookie を、レスポンスで失効させる。
 *
 * 使う場面は 2 つ: ログアウト (#195) と、壊れた cookie からの自己修復 (#197)。
 *
 * ⚠️ **`expires` を省いて `maxAge: 0` だけにしてはいけない**。auth-js 自身も
 * `cookies()` 経由で同じ名前を消しに来ることがあり、1 つの名前に書き込みが
 * 2 つ並ぶと Next のマージを通って **`Max-Age=0` だけが落ち、`Path` と
 * `SameSite` しか残らない** (実測)。属性の無い空 cookie は削除ではなく
 * セッション cookie なので、ブラウザには**残る**。`Expires` はマージを越えて
 * 生き残るため両方付ける。
 *
 * ⚠️ 検証はヘッダを読むだけでは不十分。どちらの形でも `Set-Cookie` 自体は
 * 出るので、実際に消えるかは**ブラウザの cookie jar** で見ること。
 */
export function expireAuthCookies(
  request: Request,
  response: NextResponse,
): void {
  for (const { name } of parseCookieHeader(
    request.headers.get("cookie") ?? "",
  )) {
    if (isSupabaseAuthCookie(name)) {
      response.cookies.set(name, "", {
        ...DEFAULT_COOKIE_OPTIONS,
        maxAge: 0,
        expires: new Date(0),
      });
    }
  }
}
