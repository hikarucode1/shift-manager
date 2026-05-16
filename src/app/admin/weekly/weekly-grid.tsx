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

  const filtered = useMemo(() => {
    if (!tutorFilter) return schedule.slots;
    return schedule.slots.map((row) => ({
      ...row,
      cellsByDate: Object.fromEntries(
        Object.entries(row.cellsByDate).map(([date, cells]) => [
          date,
          cells.filter((c) => c.tutorId === tutorFilter),
        ]),
      ),
    }));
  }, [schedule.slots, tutorFilter]);

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
            <span className="ml-auto">出勤 {schedule.totalShiftCount} 件</span>
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
                                className="rounded bg-card p-1.5 ring-1 ring-border"
                              >
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="font-medium">
                                    {c.tutorName}
                                  </span>
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
