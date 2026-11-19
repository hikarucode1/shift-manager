import { timingSafeEqual } from "node:crypto";
import { sendDueShiftReminders } from "@/lib/shift-reminders";

/**
 * メモ15: 出勤前のリマインドを送る。Supabase の pg_cron が 5 分ごとに
 * `Authorization: Bearer <CRON_SECRET>` を付けて POST する
 * (設定 SQL: docs/runbooks/shift-reminder-cron.md)。
 *
 * ログイン不要で叩けるよう middleware の対象から外している (src/middleware.ts)。
 * そのかわり CRON_SECRET が一致しなければ何もしない。未設定なら常に 503
 * (secret 無しで開いたままにしない)。
 */
export const dynamic = "force-dynamic";

function authorized(header: string | null, secret: string): boolean {
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json({ ok: false, error: "not configured" }, { status: 503 });
  }
  if (!authorized(req.headers.get("authorization"), secret)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await sendDueShiftReminders();
    return Response.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("shift reminders run failed:", e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
