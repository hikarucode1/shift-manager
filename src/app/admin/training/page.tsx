import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import {
  getHeatmapData,
  getHeatmapPeriods,
  getTrainingTutorNotes,
} from "@/lib/training-overview";
import { formatDateRange } from "@/lib/training-ranges";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrainingHeatmap } from "./training-heatmap";
import { NotifyPublicationButton } from "./notify-publication-button";

export default async function AdminTrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireRole("admin");
  const { period } = await searchParams;

  if (period) {
    const [data, tutorNotes] = await Promise.all([
      getHeatmapData(period),
      getTrainingTutorNotes(period),
    ]);
    if (data) {
      return (
        <div className="space-y-6">
          <div>
            <Link
              href="/admin/training"
              className="text-sm text-muted-foreground hover:underline"
            >
              ← 講習期間の一覧へ
            </Link>
            <h1 className="mt-1 text-2xl font-semibold">{data.period.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.period.startDate} 〜 {data.period.endDate} ／ 提出{" "}
              {data.submittedTutorCount} / {data.totalTutorCount} 名
            </p>
            <div className="mt-2">
              <NotifyPublicationButton periodId={period} />
            </div>
          </div>
          <TrainingHeatmap data={data} />
          {/* #319: 講師ごとの備考・テスト期間・夏休み */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">講師ごとの備考・予定</CardTitle>
              <CardDescription>
                備考かテスト期間・夏休みを入れた講師だけを表示します。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tutorNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  まだ誰も入れていません。
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {tutorNotes.map((n) => (
                    <li key={n.tutorId} className="space-y-0.5 py-2">
                      <div className="font-medium">{n.name}</div>
                      {(n.testFrom || n.summerFrom) && (
                        <div className="text-xs text-muted-foreground">
                          {n.testFrom && n.testTo && (
                            <span className="mr-3">
                              テスト期間 {formatDateRange(n.testFrom, n.testTo)}
                            </span>
                          )}
                          {n.summerFrom && n.summerTo && (
                            <span>
                              夏休み {formatDateRange(n.summerFrom, n.summerTo)}
                            </span>
                          )}
                        </div>
                      )}
                      {n.note.trim() && (
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                          {n.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }
  }

  const periods = await getHeatmapPeriods();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">講習希望（俯瞰）</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講習期間ごとに、各日・各コマの希望者数をヒートマップで確認します。
        </p>
      </div>

      {periods.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            講習期間がありません。「講習期間管理」から作成してください。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {periods.map((p) => (
            <Link key={p.id} href={`/admin/training?period=${p.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription>
                      {p.startDate} 〜 {p.endDate}
                    </CardDescription>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
