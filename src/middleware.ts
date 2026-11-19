import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static | _next/image | favicon.ico
     * - any file with an extension (svg, png, jpg, ...)
     * - api/health (#275: 監視が認証なしで叩く。毎回認証 API を呼ばないためにも外す)
     * - manifest.webmanifest (#318: ブラウザは cookie なしで取りに来る。認証を
     *   通すと /login へ飛ばされて、ホーム画面に追加してもアプリにならない)
     * - sw.js (#318: Service Worker の更新確認は cookie なしで来ることがある。
     *   /login へ飛ばされると登録・更新に失敗して Push が止まる)
     * - api/cron/shift-reminders (メモ15: pg_cron が cookie なしで叩く。
     *   route 側で CRON_SECRET を確かめる)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/health$|api/cron/shift-reminders$|sw\\.js$|manifest\\.webmanifest$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
