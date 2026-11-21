import Link from "next/link";
import { ChevronLeft, FileText, ExternalLink } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { listMonthlySchedules } from "@/lib/monthly-schedule-db";
import { monthLabel, schedulePdfPath } from "@/lib/monthly-schedule";
import { jstMonthStart } from "@/lib/week";

/**
 * 室長レビュー要望12: 講師が月のスケジュール (PDF) を開く。
 * 今月以降を出す (過ぎた月は要らない)
 */
export default async function TutorSchedulesPage() {
  await requireRole("tutor");
  const thisMonth = jstMonthStart();
  const rows = (await listMonthlySchedules(thisMonth)).sort((a, b) =>
    a.month < b.month ? -1 : 1,
  );

  return (
    <div className="space-y-4">
      <Link
        href="/tutor"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        ホーム
      </Link>
      <div className="rounded-xl bg-primary p-4 text-primary-foreground">
        <h1 className="text-xl font-bold">月のスケジュール</h1>
        <p className="mt-1 text-sm text-primary-foreground/80">
          休校日・時間割を確認してください。タップすると PDF が開きます。
        </p>
      </div>
      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.month}>
              <a
                href={schedulePdfPath(r.month)}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
              >
                <FileText className="size-5 shrink-0 text-primary" />
                <span className="flex-1 text-sm font-medium">
                  {monthLabel(r.month)}のスケジュール
                  {r.month === thisMonth && (
                    <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                      今月
                    </span>
                  )}
                </span>
                <ExternalLink className="size-4 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          まだスケジュールが出ていません。
        </p>
      )}
    </div>
  );
}
