"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { HeatmapData } from "@/lib/training-overview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** "2026-12-21" → "2026年12月21日" (座席表システムの「複数コマ出勤登録」と同じ書き方) */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/**
 * 室長レビュー要望11: 教室長は提出された講習シフトを見ながら、座席表システムの
 * 「〇〇さんの複数コマ出勤登録」(行 = 日付・曜日、列 = 各コマの時刻) に打ち込む。
 * 写しやすいように、講師 1 人ずつ同じ並びの縦の表で出す
 */
export function TutorWishTable({ data }: { data: HeatmapData }) {
  const { slots, days, tutorsByCell } = data;

  // 提出した講師と、その講師が希望した "date|slot" の集合
  const { tutors, wishes } = useMemo(() => {
    const names = new Map<string, string>();
    const wishes = new Map<string, Set<string>>();
    for (const [cell, list] of Object.entries(tutorsByCell)) {
      for (const t of list) {
        names.set(t.id, t.name);
        let set = wishes.get(t.id);
        if (!set) wishes.set(t.id, (set = new Set()));
        set.add(cell);
      }
    }
    const tutors = [...names]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return { tutors, wishes };
  }, [tutorsByCell]);

  const [tutorId, setTutorId] = useState<string | null>(
    () => tutors[0]?.id ?? null,
  );
  const index = tutors.findIndex((t) => t.id === tutorId);
  const current = index >= 0 ? tutors[index] : null;
  const set = current ? (wishes.get(current.id) ?? new Set<string>()) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">講師ごとの希望（座席表への入力用）</CardTitle>
        <CardDescription>
          座席表の「複数コマ出勤登録」と同じ並びです。✓ が出勤できるコマです。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tutors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            まだ誰も提出していません。
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={index <= 0}
                onClick={() => setTutorId(tutors[index - 1].id)}
                aria-label="前の講師"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <select
                value={tutorId ?? ""}
                onChange={(e) => setTutorId(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                aria-label="講師"
              >
                {tutors.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={index < 0 || index >= tutors.length - 1}
                onClick={() => setTutorId(tutors[index + 1].id)}
                aria-label="次の講師"
              >
                <ChevronRight className="size-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {index + 1} / {tutors.length} 人（提出した講師）
              </span>
            </div>

            {current && set && (
              <div className="overflow-x-auto">
                <p className="mb-1 text-sm font-semibold">
                  {current.name}さん（{set.size} コマ）
                </p>
                <table className="border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted">
                      <th className="border px-3 py-1 font-medium">日付</th>
                      <th className="border px-2 py-1 font-medium">曜日</th>
                      {slots.map((s) => (
                        <th
                          key={s.slotNumber}
                          className="border px-2 py-1 font-medium tabular-nums"
                        >
                          {s.startTime || s.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => {
                      const anyOn = slots.some((s) =>
                        set.has(`${d.date}|${s.slotNumber}`),
                      );
                      return (
                        <tr
                          key={d.date}
                          className={cn(!anyOn && "text-muted-foreground")}
                        >
                          <td className="whitespace-nowrap border px-3 py-1 text-center tabular-nums">
                            {longDate(d.date)}
                          </td>
                          <td
                            className={cn(
                              "border px-2 py-1 text-center",
                              d.weekdayLabel === "土" && "text-blue-600",
                              d.weekdayLabel === "日" && "text-red-600",
                            )}
                          >
                            {d.weekdayLabel}
                          </td>
                          {slots.map((s) => {
                            const on = set.has(`${d.date}|${s.slotNumber}`);
                            return (
                              <td
                                key={s.slotNumber}
                                className={cn(
                                  "border px-2 py-1 text-center",
                                  on && "bg-primary/10",
                                )}
                              >
                                {on ? (
                                  <Check
                                    className="mx-auto size-4 text-primary"
                                    aria-label="出勤できる"
                                  />
                                ) : (
                                  <span className="text-muted-foreground/40">
                                    ・
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
