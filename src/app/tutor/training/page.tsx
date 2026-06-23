import Link from "next/link";
import { and, asc, eq, gte } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { courseConfirmations, periods } from "@/db/schema";
import {
  getActiveTrainingPeriods,
  getTrainingEditorData,
  type TrainingEditorData,
} from "@/lib/training";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { jstToday } from "@/lib/week";
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

  const today = jstToday();
  const [activePeriods, confirmedRows] = await Promise.all([
    getActiveTrainingPeriods(),
    // Issue #75 (ε): 自分の確定済み講習シフト (今日以降の日付のみ)。
    // period_name も併せて取得して期ごとにグループ化表示。
    db
      .select({
        periodId: courseConfirmations.periodId,
        periodName: periods.name,
        date: courseConfirmations.date,
        slotNumber: courseConfirmations.slotNumber,
      })
      .from(courseConfirmations)
      .innerJoin(periods, eq(periods.id, courseConfirmations.periodId))
      .where(
        and(
          eq(courseConfirmations.tutorId, profile.id),
          gte(courseConfirmations.date, today),
        ),
      )
      .orderBy(
        asc(courseConfirmations.date),
        asc(courseConfirmations.slotNumber),
      ),
  ]);

  // 期ごとに { date → slot番号配列 } にグループ化
  const confirmedByPeriod = new Map<
    string,
    { name: string; daySlots: Map<string, number[]> }
  >();
  for (const r of confirmedRows) {
    const bucket = confirmedByPeriod.get(r.periodId) ?? {
      name: r.periodName,
      daySlots: new Map<string, number[]>(),
    };
    const slots = bucket.daySlots.get(r.date) ?? [];
    slots.push(r.slotNumber);
    bucket.daySlots.set(r.date, slots);
    confirmedByPeriod.set(r.periodId, bucket);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">講習希望提出</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講習期間ごとに、勤務できるコマを選んで提出します。締切までは何度でも変更できます。
        </p>
      </div>

      {/* Issue #75 (ε): 自分の確定済み講習シフト (read-only) */}
      {confirmedByPeriod.size > 0 && (
        <Card className="border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30">
          <CardHeader>
            <CardTitle className="text-base">確定済み講習シフト</CardTitle>
            <CardDescription>
              教室長が確定した出勤日です (今日以降)。希望提出と異なる場合があります。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {Array.from(confirmedByPeriod.entries()).map(
              ([periodId, { name, daySlots }]) => (
                <div key={periodId}>
                  <div className="font-medium">{name}</div>
                  <ul className="ml-4 text-muted-foreground">
                    {Array.from(daySlots.entries()).map(([date, slots]) => (
                      <li key={date}>
                        {date}: {slots.map((s) => `${s}限`).join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </CardContent>
        </Card>
      )}

      {activePeriods.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            現在、提出できる講習期間はありません。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {activePeriods.map((p) => (
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
function serializeData(d: TrainingEditorData) {
  return {
    period: d.period,
    slots: d.slots,
    days: d.days,
    selected: [...d.selected],
    note: d.note,
  };
}
