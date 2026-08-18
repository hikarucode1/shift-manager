import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readAuthUser } from "@/lib/auth-availability";

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
  const read = await readAuthUser(supabase);

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
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
