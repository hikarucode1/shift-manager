import { timingSafeEqual } from "node:crypto";
import { sendDueShiftReminders } from "@/lib/shift-reminders";
import { sendDueRegularOpenNotices } from "@/lib/submission-open-sender";

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
  const [reminders, regularOpen] = await Promise.allSettled([
    sendDueShiftReminders(),
    sendDueRegularOpenNotices(),
  ]);
  if (reminders.status === "rejected") {
    console.error("shift reminders run failed:", reminders.reason);
  }
  if (regularOpen.status === "rejected") {
    console.error("regular open notices run failed:", regularOpen.reason);
  }
  const ok =
    reminders.status === "fulfilled" && regularOpen.status === "fulfilled";
  return Response.json(
    {
      ok,
      ...(reminders.status === "fulfilled" ? reminders.value : {}),
      regularOpen:
        regularOpen.status === "fulfilled" ? regularOpen.value : null,
    },
    { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } },
  );
}
