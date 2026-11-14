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
     */
    "/((?!_next/static|_next/image|favicon.ico|api/health$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
