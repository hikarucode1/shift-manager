"use client";

import { useState } from "react";
import { CalendarOff, MapPin } from "lucide-react";
import type { WeekSchedule } from "@/lib/tutor-schedule";
import { shortDate } from "@/lib/week";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function WeekScheduleView({
  thisWeek,
  nextWeek,
}: {
  thisWeek: WeekSchedule;
  nextWeek: WeekSchedule | null;
}) {
  const [tab, setTab] = useState<"this" | "next">("this");
  const active = tab === "next" && nextWeek ? nextWeek : thisWeek;

  return (
    <div className="space-y-4">
      {nextWeek && (
        <div
          role="tablist"
          aria-label="表示する週"
          className="flex gap-1 rounded-lg bg-muted p-1 text-sm"
        >
          <TabButton
            active={tab === "this"}
            onClick={() => setTab("this")}
            label="今週"
            sub={`${shortDate(thisWeek.range.start)}〜${shortDate(thisWeek.range.end)}`}
          />
          <TabButton
            active={tab === "next"}
            onClick={() => setTab("next")}
            label="来週"
            sub={`${shortDate(nextWeek.range.start)}〜${shortDate(nextWeek.range.end)}`}
          />
        </div>
      )}

      {!active.hasAnyShift ? (
        <EmptyState published={active.published} />
      ) : (
        <div className="grid gap-3">
          {active.days.map((day) => (
            <DayCard key={day.date} day={day} />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-3 py-2 text-center transition-colors",
        active
          ? "bg-background font-medium shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <div>{label}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </button>
  );
}

function EmptyState({ published }: { published: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <CalendarOff className="size-10 text-muted-foreground/60" />
        <div>
          {published ? (
            <>
              <p className="font-medium">この週は出勤予定がありません</p>
              <p className="mt-1 text-sm text-muted-foreground">
                座席表は公開済みですが、あなたのシフトはありません。
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">
                この週の座席表はまだ公開されていません
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                教室長が CSV をアップロードすると、ここに表示されます。
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DayCard({ day }: { day: WeekSchedule["days"][number] }) {
  const isWeekend = day.weekday === "sat" || day.weekday === "sun";
  const hasShift = day.slots.length > 0;

  return (
    <Card className={cn(!hasShift && "opacity-60")}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span>{shortDate(day.date)}</span>
          <Badge
            variant={isWeekend ? "secondary" : "outline"}
            className="font-normal"
          >
            {day.weekdayLabel}
          </Badge>
        </CardTitle>
        {!hasShift && (
          <span className="text-xs text-muted-foreground">出勤なし</span>
        )}
      </CardHeader>
      {hasShift && (
        <CardContent className="space-y-2 pt-0">
          {day.slots.map((slot) => (
            <div
              key={slot.slotNumber}
              className="rounded-md border bg-card p-3"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{slot.label}</span>
                <span className="text-sm text-muted-foreground">
                  {slot.startTime}〜{slot.endTime}
                </span>
                {slot.seatNumber && (
                  <Badge variant="outline" className="gap-1 font-normal">
                    <MapPin className="size-3" />座{slot.seatNumber}
                  </Badge>
                )}
                {slot.isOverride && (
                  <Badge variant="accent" className="font-normal">
                    代講・差替
                  </Badge>
                )}
                {slot.isAbsent && (
                  <Badge variant="destructive" className="font-normal">
                    欠勤（承認済）
                  </Badge>
                )}
              </div>
              {slot.students.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {slot.students.map((s, i) => (
                    <li key={`${s.name}-${s.subject}-${i}`} className="text-sm">
                      <span className="font-medium">{s.name}</span>
                      {s.subject && (
                        <span className="ml-1 text-muted-foreground">
                          （{s.subject}）
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  生徒の割り当てなし
                </p>
              )}
              {slot.note && (
                <p className="mt-2 text-xs text-muted-foreground">
                  メモ: {slot.note}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
