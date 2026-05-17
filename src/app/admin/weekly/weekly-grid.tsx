"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText, Printer } from "lucide-react";
import type { AdminWeekSchedule } from "@/lib/admin-schedule";
import { nextWeek, prevWeek, shortDate } from "@/lib/week";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
      {/* 週ナビ */}
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

      {/* アップロード情報 */}
      {schedule.upload && (
        <Card className="print:border-0 print:shadow-none">
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="size-4" />
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
            <span className="ml-auto">
              {tutorFilter
                ? `表示中 ${shownCount} 件 / 全 ${schedule.totalShiftCount} 件`
                : `出勤 ${schedule.totalShiftCount} 件`}
              {schedule.absentShiftCount > 0 && (
                <span className="ml-2 text-destructive">
                  欠勤 {schedule.absentShiftCount} 件
                </span>
              )}
            </span>
          </CardContent>
        </Card>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-24 border bg-muted p-2 text-left">
                  コマ
                </th>
                {schedule.days.map((d) => {
                  const weekend =
                    d.weekday === "sat" || d.weekday === "sun";
                  return (
                    <th
                      key={d.date}
                      className={cn(
                        "border bg-muted p-2 text-center font-medium",
                        weekend && "text-muted-foreground",
                      )}
                    >
                      <div>{shortDate(d.date)}</div>
                      <div className="text-xs font-normal">
                        ({d.weekdayLabel})
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.slotNumber} className="align-top">
                  <th className="sticky left-0 z-10 border bg-muted p-2 text-left">
                    <div className="font-medium">{row.label}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {row.startTime}
                      {row.startTime && "〜"}
                      {row.endTime}
                    </div>
                  </th>
                  {schedule.days.map((d) => {
                    const cells = row.cellsByDate[d.date] ?? [];
                    return (
                      <td key={d.date} className="border p-1.5 align-top">
                        {cells.length === 0 ? (
                          <span className="text-xs text-muted-foreground/50">
                            —
                          </span>
                        ) : (
                          <ul className="space-y-1.5">
                            {cells.map((c) => (
                              <li
                                key={c.tutorId}
                                title={c.note ?? undefined}
                                className={cn(
                                  "rounded p-1.5 ring-1 ring-border",
                                  c.isAbsent
                                    ? "bg-destructive/10"
                                    : "bg-card",
                                )}
                              >
                                <div className="flex flex-wrap items-center gap-1">
                                  <span
                                    className={cn(
                                      "font-medium",
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
                                  {c.seatNumber && (
                                    <Badge
                                      variant="outline"
                                      className="px-1 py-0 text-[10px] font-normal"
                                    >
                                      座{c.seatNumber}
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
                                </div>
                                {c.students.length > 0 && (
                                  <div className="mt-0.5 text-xs text-muted-foreground">
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
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
