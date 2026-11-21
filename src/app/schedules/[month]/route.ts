import { requireSession } from "@/lib/auth";
import { getMonthlySchedulePdf } from "@/lib/monthly-schedule-db";
import { monthStartOf } from "@/lib/monthly-schedule";

/**
 * 室長レビュー要望12: 月のスケジュール PDF をブラウザで開く。
 * ログインしている人 (講師・教室長) だけ。/schedules/2026-12 の形
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ month: string }> },
) {
  await requireSession();
  const month = monthStartOf((await params).month);
  if (!month) return new Response("Not found", { status: 404 });
  const pdf = await getMonthlySchedulePdf(month);
  if (!pdf) return new Response("Not found", { status: 404 });
  // ファイル名は日本語を含みうるので RFC 5987 の形で渡す
  const name = encodeURIComponent(pdf.fileName);
  return new Response(new Uint8Array(pdf.content), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
    },
  });
}
