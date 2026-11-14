import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { checkHealth } from "@/lib/health";

/**
 * 死活監視用 (#275)。DB に select 1 が通れば 200、通らなければ 503。
 * 認証なしで叩けるよう middleware の対象から外している (src/middleware.ts)。
 * 認証 API の障害は #193 の経路で別に扱うので、ここでは見ない
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { status, body } = await checkHealth(() => db.execute(sql`select 1`));
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
