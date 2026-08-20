import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readAuthUser, type AuthUserRead } from "@/lib/auth-availability";
import { expireAuthCookies } from "@/lib/supabase/auth-cookies";
import { reportIncident } from "@/lib/incident";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: Don't run code between createServerClient and getUser.
  let read: AuthUserRead;
  let corruptedSession = false;

  try {
    read = await readAuthUser(supabase);
  } catch (e) {
    // #197: 保存済みセッションを**読む段階**で壊れている。auth-js の _getUser は
    // isAuthError(error) を return し、そうでないものだけ throw する。ネットワーク
    // 失敗も 5xx も AuthError なので return 側に回る = ここに来るのは
    // 「セッションを読めなかった」。実例はチャンク cookie の**破損**で
    // @supabase/ssr の base64url デコードが throw するケース (実測)。
    //
    // なお chunk の**欠損** (`.1` が消えて `.0` だけ残る) はここを通らない。
    // combineChunks が falsy な chunk で打ち切り AuthSessionMissingError を
    // return するので (実測)、普通の未ログインとして /login へ送られる。
    // 残った `.0` は失効させないが、再ログインで上書きされるので実害は無い。
    //
    // 捕まえないと middleware ごと 500 になり、matcher が全経路に掛かるので
    // /login も /auth/signout も 500 = **アプリ側から回復する手段が無くなる**
    // (ブラウザで cookie を消すしかない)。
    //
    // 壊れた cookie はサーバー障害ではないので SystemUnavailable には寄せない。
    // 「壊れていたら捨てて出直させる」= 未ログインとして通常の分岐に流し、
    // 返すレスポンスに失効ヘッダを載せる。次のリクエストには壊れた cookie が
    // 付かないのでループしない。
    corruptedSession = true;
    reportIncident("middleware-auth-cookie", e);
    read = { reachable: true, user: null };
  }

  // #193: 認証 API に到達できないのは「ログアウト」ではない。ここで /login へ
  // 307 すると、DB/GoTrue がまとめて止まる Supabase の pause 時に全リクエストが
  // layout に着く前に弾かれ、#188 の SystemUnavailable に到達できない。
  // 素通しして各 layout / page のガードに判断させる。
  //
  // ⚠️ 素通ししてもコンテンツは出ない。認可は各 page の requireRole() が担保しており
  // (18 ページすべてが呼ぶ)、その requireSession() は同じ判別で throw する。
  // middleware は throw できない (シェルごと 500 になる) のでここだけ素通しにする。
  if (!read.reachable) {
    console.error("[middleware] auth unreachable", read.error);
    return supabaseResponse;
  }

  const user = read.user;
  const url = request.nextUrl;
  const isAuthRoute =
    url.pathname.startsWith("/login") || url.pathname.startsWith("/auth");
  const isPublicAsset =
    url.pathname.startsWith("/_next") ||
    url.pathname.startsWith("/favicon") ||
    url.pathname === "/";

  if (!user && !isAuthRoute && !isPublicAsset) {
    const redirectUrl = url.clone();
    redirectUrl.pathname = "/login";
    const redirect = NextResponse.redirect(redirectUrl);
    // 失効ヘッダは **実際に返すレスポンス** に載せる (supabaseResponse ではない)
    if (corruptedSession) expireAuthCookies(request, redirect);
    return redirect;
  }

  if (corruptedSession) expireAuthCookies(request, supabaseResponse);

  return supabaseResponse;
}
