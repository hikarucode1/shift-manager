"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText, Printer } from "lucide-react";
import type { AdminDay, AdminWeekSchedule } from "@/lib/admin-schedule";
import { nextWeek, prevWeek, shortDate } from "@/lib/week";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// 曜日色: 平日=slate / 土=青 / 日=赤（デザインハンドオフ準拠）
function dayColor(weekday: AdminDay["weekday"]) {
  if (weekday === "sat") return "text-blue-600";
  if (weekday === "sun") return "text-destructive";
  return "text-slate-600";
}

export function WeeklyGrid({ schedule }: { schedule: AdminWeekSchedule }) {
  const router = useRouter();
  const [tutorFilter, setTutorFilter] = useState<string>("");

  const prev = prevWeek(schedule.range);
  const next = nextWeek(schedule.range);

  const { rows: filtered, count: shownCount } = useMemo(() => {
    if (!tutorFilter) {
      return { rows: schedule.slots, count: schedule.totalShiftCount };
    }
    let count = 0;
    const rows = schedule.slots
      .map((row) => {
        const cellsByDate: typeof row.cellsByDate = {};
        for (const [date, cells] of Object.entries(row.cellsByDate)) {
          const kept = cells.filter((c) => c.tutorId === tutorFilter);
          if (kept.length > 0) {
            cellsByDate[date] = kept;
            count += kept.length;
          }
        }
        return { ...row, cellsByDate };
      })
      // フィルタ時は空コマ行を畳む
      .filter((row) => Object.keys(row.cellsByDate).length > 0);
    return { rows, count };
  }, [schedule.slots, schedule.totalShiftCount, tutorFilter]);

  return (
    <div className="space-y-4">
      {/* ツールバー: 前週 / 週ラベル / 次週・右に講師select + 印刷 */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/weekly?week=${prev.start}`}>
            <ChevronLeft />
            前週
          </Link>
        </Button>
        <div className="text-sm font-medium">
          {schedule.range.start} 〜 {schedule.range.end}
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/weekly?week=${next.start}`}>
            次週
            <ChevronRight />
          </Link>
        </Button>

        <input
          type="date"
          defaultValue={schedule.range.start}
          onChange={(e) => {
            if (e.target.value)
              router.push(`/admin/weekly?week=${e.target.value}`);
          }}
          className="ml-2 h-8 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="週の日付を指定"
        />

        <div className="ml-auto flex items-center gap-2">
          <select
            value={tutorFilter}
            onChange={(e) => setTutorFilter(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="講師で絞り込み"
          >
            <option value="">全講師</option>
            {schedule.tutors.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            aria-label="印刷"
          >
            <Printer />
            印刷
          </Button>
        </div>
      </div>

      {/* アップロード情報バー */}
      {schedule.upload && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted px-3.5 py-2.5 text-[12.5px] text-muted-foreground print:border-0">
          <span className="flex items-center gap-1.5">
            <FileText className="size-3.5" />
            {schedule.upload.originalFilename}
          </span>
          <span>公開者: {schedule.upload.uploadedByName}</span>
          {schedule.upload.publishedAt && (
            <span>
              公開:{" "}
              {new Date(schedule.upload.publishedAt).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })}
            </span>
          )}
          <span className="ml-auto font-semibold text-foreground">
            {tutorFilter
              ? `表示中 ${shownCount} 件 / 全 ${schedule.totalShiftCount} 件`
              : `出勤 ${schedule.totalShiftCount} 件`}
            {schedule.absentShiftCount > 0 && (
              <span className="ml-2 font-medium text-destructive">
                欠勤 {schedule.absentShiftCount} 件
              </span>
            )}
          </span>
        </div>
      )}

      {!schedule.published ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">
              この週の座席表はまだ公開されていません
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              「Excel取り込み」から CSV をアップロードして公開してください。
            </p>
          </CardContent>
        </Card>
      ) : (
        // 外側を overflow-x-auto + border にして、先頭「コマ」列の sticky を
        // スクロールコンテナ基準で効かせる。各コマ行は subgrid ラッパで囲み、
        // 実 DOM ボックスとして break-inside:avoid を行単位で効かせる (印刷分割対策)。
        <div className="overflow-x-auto rounded-lg border">
          <div className="weekly-grid grid min-w-[900px] grid-cols-[92px_repeat(7,1fr)] text-sm">
            {/* ヘッダー行 */}
            <div className="col-span-full grid grid-cols-subgrid break-inside-avoid">
              <div className="sticky left-0 z-10 border-b bg-muted px-2.5 py-2 text-xs font-semibold text-slate-600">
                コマ
              </div>
              {schedule.days.map((d) => (
                <div
                  key={d.date}
                  className="border-b border-l bg-muted px-1 py-1.5 text-center"
                >
                  <div className={cn("text-[13px] font-semibold", dayColor(d.weekday))}>
                    {shortDate(d.date)}
                  </div>
                  <div className={cn("text-[11px] opacity-80", dayColor(d.weekday))}>
                    ({d.weekdayLabel})
                  </div>
                </div>
              ))}
            </div>

            {/* コマ行 */}
            {filtered.map((row) => (
              <div
                key={row.slotNumber}
                className="col-span-full grid grid-cols-subgrid break-inside-avoid"
              >
                <div className="sticky left-0 z-10 border-b bg-card px-2.5 py-2">
                  <div className="text-[13px] font-semibold">{row.label}</div>
                  <div className="text-[10.5px] text-muted-foreground">
                    {row.startTime}
                    {row.startTime && "〜"}
                    {row.endTime}
                  </div>
                </div>
                {schedule.days.map((d) => {
                  const cells = row.cellsByDate[d.date] ?? [];
                  return (
                    <div
                      key={d.date}
                      className="flex min-h-[46px] flex-col gap-1 border-b border-l p-1.5"
                    >
                      {cells.length === 0 ? (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      ) : (
                        cells.map((c) => (
                          <div
                            key={c.tutorId}
                            title={c.note ?? undefined}
                            className={cn(
                              "rounded p-1.5 text-xs ring-1",
                              c.isAbsent
                                ? "bg-destructive/10 ring-destructive/20"
                                : c.isOverride
                                  ? "bg-accent/10 ring-accent/20"
                                  : "bg-muted ring-border",
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-1">
                              <span
                                className={cn(
                                  "font-semibold",
                                  c.isAbsent &&
                                    "text-muted-foreground line-through",
                                )}
                              >
                                {c.tutorName}
                              </span>
                              {c.isAbsent && (
                                <Badge
                                  variant="destructive"
                                  className="px-1 py-0 text-[10px] font-normal"
                                >
                                  欠勤
                                </Badge>
                              )}
                              {c.isOverride && (
                                <Badge
                                  variant="accent"
                                  className="px-1 py-0 text-[10px] font-normal"
                                >
                                  代講
                                </Badge>
                              )}
                              {c.seatNumber && (
                                <Badge
                                  variant="outline"
                                  className="px-1 py-0 text-[10px] font-normal"
                                >
                                  座{c.seatNumber}
                                </Badge>
                              )}
                            </div>
                            {c.students.length > 0 && (
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                {c.students
                                  .map(
                                    (s) =>
                                      `${s.name}${s.subject ? `(${s.subject})` : ""}`,
                                  )
                                  .join(" / ")}
                              </div>
                            )}
                            {c.note && (
                              <div className="mt-0.5 text-[10px] text-muted-foreground">
                                メモ: {c.note}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
