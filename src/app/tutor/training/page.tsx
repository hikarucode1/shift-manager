import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import {
  getActiveTrainingPeriods,
  getTrainingEditorData,
} from "@/lib/training";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrainingEditor } from "./training-editor";

function deadlineLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
  });
}

export default async function TutorTrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { profile } = await requireRole("tutor");
  const { period } = await searchParams;

  if (period) {
    const data = await getTrainingEditorData(profile.id, period);
    if (data) {
      return (
        <div className="space-y-6">
          <div>
            <Link
              href="/tutor/training"
              className="text-sm text-muted-foreground hover:underline"
            >
              ← 講習期間の一覧へ
            </Link>
            <h1 className="mt-1 text-2xl font-semibold">{data.period.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.period.startDate} 〜 {data.period.endDate} ／ 締切{" "}
              {deadlineLabel(data.period.submissionDeadline)}
            </p>
          </div>
          <TrainingEditor data={serializeData(data)} />
        </div>
      );
    }
  }

  const periods = await getActiveTrainingPeriods();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">講習希望提出</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講習期間ごとに、勤務できるコマを選んで提出します。締切までは何度でも変更できます。
        </p>
      </div>

      {periods.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            現在、提出できる講習期間はありません。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {periods.map((p) => (
            <Link key={p.id} href={`/tutor/training?period=${p.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription>
                      {p.startDate} 〜 {p.endDate} ／ 締切{" "}
                      {deadlineLabel(p.submissionDeadline)}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.isReopened ? (
                      <Badge variant="destructive">締切無視中（提出可）</Badge>
                    ) : p.editable ? (
                      <Badge variant="secondary">
                        {p.daysLeft > 0
                          ? `あと ${p.daysLeft} 日`
                          : "本日締切"}
                      </Badge>
                    ) : (
                      <Badge variant="outline">締切終了</Badge>
                    )}
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Set はクライアントに渡せないため配列化 */
function serializeData(
  d: Awaited<ReturnType<typeof getTrainingEditorData>> & object,
) {
  return {
    period: d.period,
    slots: d.slots,
    days: d.days,
    selected: [...d.selected],
    note: d.note,
  };
}
