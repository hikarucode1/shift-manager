import { NextResponse } from "next/server";
import { DEFAULT_COOKIE_OPTIONS, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/server";
import { reportIncident } from "@/lib/incident";

/**
 * Supabase の認証 cookie。`sb-<project-ref>-auth-token` を基点に、
 * 長い値のチャンク (`.0` `.1` ...) と `-code-verifier` / `-user` が並ぶ
 * (auth-js が消しているのもこの 3 種)。
 *
 * project-ref を含むので名前を決め打ちできず、storageKey は auth-js 側で
 * `protected` なので型からも触れない。ここでは命名規約だけで拾う。
 *
 * ⚠️ 削除は `path=/` 決め打ち。`@supabase/ssr` は
 * `{...DEFAULT_COOKIE_OPTIONS, ...cookieOptions}` で書くので、将来
 * `createClient()` に `cookieOptions` を渡すならここも合わせること
 * (path が食い違うと消したつもりで残る)。
 */
function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

/**
 * リクエストが持っている認証 cookie を、レスポンスで失効させる。
 *
 * ⚠️ **`expires` を省いて `maxAge: 0` だけにしてはいけない**。成功パスでは
 * auth-js 自身も `cookies()` 経由で同じ名前を消しに来るので 1 つの名前に
 * 2 つの書き込みが並び、Next のマージを通ると **`Max-Age=0` だけが落ちて
 * `Path` と `SameSite` しか残らない** (実測)。属性の無い空 cookie は削除では
 * なくセッション cookie なので、ブラウザには**残る**。`Expires` はマージを
 * 越えて生き残るため両方付ける。
 */
function expireAuthCookies(request: Request, response: NextResponse): void {
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

/**
 * ログアウト (#195)。
 *
 * **不変条件: このエンドポイントを叩いたら、ブラウザの認証 cookie は必ず消える。**
 * サーバー側のログアウトが成功したかどうかに関わらず失効させる。
 *
 * ⚠️ **`supabase.auth.signOut()` に任せてはいけない**。理由が 3 つある:
 *
 * 1. auth-js の `_signOut` はサーバーへのログアウト要求が失敗すると
 *    **cookie を消す前に return する** (`GoTrueClient._signOut`)。認証 API に
 *    届かないと cookie は残ったままで、それを見ずに `/login` へ送ると
 *    **「ログアウトしたのにログアウトされていない」**。共用 PC で次に座った人が
 *    そのまま入れてしまう。
 * 2. **`{ error }` を返さず reject することがある**。cookie のチャンクが壊れて
 *    いると `@supabase/ssr` の base64url デコードが throw し、`_useSession` は
 *    try/finally で捕まえないのでそのまま抜ける (実測)。捕まえないと 500 に
 *    なり、やはり cookie は残る。
 * 3. 成功したと言っていても書き込めたとは限らない。`lib/supabase/server.ts` の
 *    `setAll` は Server Component から呼ばれた場合に備えて例外を握り潰すので、
 *    書き込み失敗は `signOut()` の戻り値に出てこない。
 *
 * 成功パスで二重に消すことになるが、auth-js が出すのと同じ `Max-Age=0` なので
 * ブラウザから見た挙動は変わらない (レスポンス側の値が優先される)。
 * おまけに `NEXT_PUBLIC_SUPABASE_URL` を変える前の `sb-<旧ref>-auth-token` など、
 * auth-js 自身には見えない残骸もここで落ちる。
 *
 * ⚠️ `signOut({ scope: "local" })` での再試行は**効かない**。
 * `GoTrueAdminApi.signOut` は scope に関係なく `POST /logout` を投げるので、
 * 到達できない状況では local でも同じ失敗になる。
 *
 * ⚠️ 直せるのは**このブラウザの分だけ**。サーバー側のセッションは refresh token
 * が失効するまで生き残るので、cookie の値を持ち出されていれば他所からは使える。
 */
export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();

    // 画面には出さない (利用者から見れば普通にログアウトできており、打つ手も
    // 無い)。サーバー側が解除できていないことは incident ID でログに残す。
    if (error) reportIncident("signout", error);
  } catch (e) {
    reportIncident("signout", e);
  }

  expireAuthCookies(request, response);

  return response;
}
