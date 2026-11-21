import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import {
  getHeatmapData,
  getHeatmapPeriods,
  getTrainingTutorStatuses,
} from "@/lib/training-overview";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrainingHeatmap } from "./training-heatmap";
import { TrainingStatusCard } from "./training-status-card";
import { NotifyPublicationButton } from "./notify-publication-button";
import { AdminShiftWishNav } from "@/components/admin-section-nav";
import { GrantChangeForm } from "./grant-change-form";
import { fetchActiveTutors } from "@/lib/upload-commit";
import { getTrainingGrantsForPeriod } from "@/lib/shift-change";

export default async function AdminTrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireRole("admin");
  const { period } = await searchParams;

  if (period) {
    const [data, tutorStatuses, activeTutors, grantMap] = await Promise.all([
      getHeatmapData(period),
      getTrainingTutorStatuses(period),
      // #333: 1 人だけ再開する
      fetchActiveTutors(),
      getTrainingGrantsForPeriod(period, new Date()),
    ]);
    const tutorName = new Map(activeTutors.map((t) => [t.id, t.displayName]));
    const grants = [...grantMap.entries()].map(([tutorId, until]) => ({
      tutorId,
      name: tutorName.get(tutorId) ?? "（退職した講師）",
      until: until.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));
    if (data) {
      return (
        <div className="space-y-6">
          <AdminShiftWishNav />
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
              {tutorStatuses.filter((t) => t.status === "submitted").length} /{" "}
              {tutorStatuses.length} 名
            </p>
            <div className="mt-2">
              <NotifyPublicationButton periodId={period} />
            </div>
          </div>
          {/* 室長レビュー要望11: レギュラーと同じ「講師別ステータス」 */}
          <TrainingStatusCard tutors={tutorStatuses} />
          <TrainingHeatmap data={data} />
          <GrantChangeForm
            periodId={period}
            tutors={activeTutors.map((t) => ({ id: t.id, name: t.displayName }))}
            grants={grants}
          />
        </div>
      );
    }
  }

  const periods = await getHeatmapPeriods();

  return (
    <div className="space-y-6">
      <AdminShiftWishNav />
      <div>
        <h1 className="text-2xl font-semibold">シフト希望（講習）</h1>
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
