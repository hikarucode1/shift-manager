import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { getMonthlyScheduleInfo } from "@/lib/monthly-schedule-db";
import {
  monthLabel,
  monthStartOf,
  schedulePdfPath,
} from "@/lib/monthly-schedule";
import { PdfViewer } from "@/components/pdf-viewer";

/**
 * 月のスケジュール (PDF) をアプリの画面の中で見るページ (講師・教室長で共通)。
 *
 * ヘッダーとメニューを残したまま PDF を描くので、ホーム画面に追加したアプリ
 * でも戻れる (2026/11/21 本人:「開いたら戻れなくなる」)。
 */
export async function SchedulePdfPage({
  ym,
  back,
}: {
  /** URL の "2026-12" */
  ym: string;
  /** 戻る先 */
  back: { href: string; label: string };
}) {
  const month = monthStartOf(ym);
  if (!month) notFound();
  const info = await getMonthlyScheduleInfo(month);
  if (!info) notFound();
  const title = `${monthLabel(month)}のスケジュール`;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {back.label}
        </Link>
        {/* 印刷や保存はブラウザの PDF 表示のほうが向くので、PC のブラウザで
            見ているときだけ出す。ホーム画面のアプリでは戻れなくなるので出さ
            ない (念のためスマホ・タブレットでも出さない) */}
        <a
          href={schedulePdfPath(month)}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline standalone:hidden touch:hidden"
        >
          別のタブで開く（印刷用）
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <h1 className="text-lg font-bold">{title}</h1>
      {/* 上げ直したら描き直す (同じ URL でも中身が変わる) */}
      <PdfViewer
        key={info.updatedAt.toISOString()}
        src={schedulePdfPath(month)}
        title={title}
      />
    </div>
  );
}
