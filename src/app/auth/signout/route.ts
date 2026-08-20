import { NextResponse } from "next/server";
import { DEFAULT_COOKIE_OPTIONS, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/server";
import { reportIncident } from "@/lib/incident";

/**
 * Supabase の認証 cookie。`sb-<project-ref>-auth-token` を基点に、
 * 長い値のチャンク (`.0` `.1` ...) と `-code-verifier` / `-user` が並ぶ
 * (auth-js の `_removeSession()` が消しているのもこの 3 種)。
 *
 * project-ref を含むので名前を決め打ちできず、storageKey は auth-js 側で
 * `protected` なので型からも触れない。ここでは命名規約だけで拾う。
 */
function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

/**
 * ログアウト (#195)。
 *
 * ⚠️ **`signOut()` の error を無視してはいけない**。auth-js の `_signOut` は
 * サーバーへのログアウト要求が失敗すると **`_removeSession()` に到達する前に
 * return する** (`GoTrueClient._signOut`)。つまり認証 API に届かないとき
 * cookie は消えないまま `{ error }` が返り、それを見ずに `/login` へ送ると
 * **「ログアウトしたのにログアウトされていない」**状態になる。共用 PC で
 * 次に座った人がそのまま入れてしまう。
 *
 * `error` の有無だけで判定してよい: 404 / 401 / 403 / セッション無し
 * (= すでに無効) は auth-js が内部で握って `_removeSession()` まで進むので、
 * ここに来る `error` は「サーバー側のログアウトを完了できなかった」に限られる。
 *
 * ⚠️ `signOut({ scope: "local" })` での再試行は**効かない**。
 * `GoTrueAdminApi.signOut` は scope に関係なく `POST /logout` を投げるので、
 * 到達できない状況では local でも同じ失敗になる。
 *
 * ⚠️ 直せるのは**このブラウザの分だけ**。サーバー側のセッションは refresh token
 * が失効するまで生き残るので、cookie の値を持ち出されていれば他所からは使える。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });

  if (error) {
    for (const { name } of parseCookieHeader(
      request.headers.get("cookie") ?? "",
    )) {
      if (isSupabaseAuthCookie(name)) {
        // 属性は @supabase/ssr が書き込むときと同じものを使う (path が
        // 食い違うと消したつもりで残る)。maxAge だけ 0 に上書きする。
        response.cookies.set(name, "", {
          ...DEFAULT_COOKIE_OPTIONS,
          maxAge: 0,
        });
      }
    }

    // 画面には出さない (利用者から見れば普通にログアウトできており、打つ手も
    // 無い)。サーバー側が解除できていないことは incident ID でログに残す。
    reportIncident("signout", error);
  }

  return response;
}
