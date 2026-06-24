import Link from "next/link";
import { AlertCircle, CalendarClock, ChevronRight, MapPin } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getTutorHomeData } from "@/lib/tutor-home";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/** 締切残り日数のラベル + 緊急かどうか */
function deadlineLabel(daysLeft: number): { text: string; urgent: boolean } {
  if (daysLeft < 0) return { text: "締切超過", urgent: true };
  if (daysLeft === 0) return { text: "本日締切", urgent: true };
  return { text: `あと${daysLeft}日`, urgent: daysLeft <= 3 };
}

/** 次の出勤の日付ラベル (今日/明日/曜日) */
function dayLabel(s: {
  isToday: boolean;
  isTomorrow: boolean;
  weekdayLabel: string;
}): string {
  if (s.isToday) return "今日";
  if (s.isTomorrow) return "明日";
  return `${s.weekdayLabel}曜`;
}

export default async function TutorHome() {
  const { profile } = await requireRole("tutor");
  const data = await getTutorHomeData(profile.id);

  const nearest = data.deadlines[0];
  // アラートは「編集可能・未提出」の最も近い締切のみ出す
  const alertDeadline = data.deadlines.find((d) => !d.submitted) ?? null;

  return (
    <div className="space-y-5">
      {/* ネイビー hero: 挨拶 + 2 統計 */}
      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <p className="text-sm text-primary-foreground/80">
          {profile.displayName} さん
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-primary-foreground/10 p-3">
            <p className="text-xs text-primary-foreground/70">今週のコマ</p>
            <p className="mt-0.5 text-2xl font-bold">
              {data.weekSlotCount}
              <span className="ml-1 text-sm font-normal">コマ</span>
            </p>
          </div>
          <div className="rounded-lg bg-primary-foreground/10 p-3">
            <p className="text-xs text-primary-foreground/70">提出締切</p>
            <p
              className={cn(
                "mt-0.5 text-2xl font-bold",
                nearest && deadlineLabel(nearest.daysLeft).urgent
                  ? "text-accent"
                  : "",
              )}
            >
              {nearest ? deadlineLabel(nearest.daysLeft).text : "—"}
            </p>
          </div>
        </div>
      </section>

      {/* 締切アラート (未提出の最近接) */}
      {alertDeadline && (
        <Link
          href={alertDeadline.href}
          className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/10 p-3 transition-colors hover:bg-accent/15"
        >
          <AlertCircle className="size-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{alertDeadline.label}</p>
            <p className="text-xs text-muted-foreground">
              {alertDeadline.dueLabel} まで・未提出あり
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {/* 次の出勤 */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">次の出勤</h2>
        {data.nextShift ? (
          <div className="rounded-xl bg-primary p-4 text-primary-foreground">
            <div className="flex items-center justify-between">
              <span className="text-sm text-primary-foreground/80">
                {dayLabel(data.nextShift)} {shortDate(data.nextShift.date)}（
                {data.nextShift.weekdayLabel}）
              </span>
              {data.nextShift.slot.seatNumber && (
                <Badge variant="accent">
                  <MapPin className="size-3" />座席 {data.nextShift.slot.seatNumber}
                </Badge>
              )}
            </div>
            <p className="mt-2 text-2xl font-bold">
              {data.nextShift.slot.label}{" "}
              <span className="text-lg font-medium">
                {data.nextShift.slot.startTime}–{data.nextShift.slot.endTime}
              </span>
            </p>
            {data.nextShift.slot.students.length > 0 && (
              <p className="mt-1 text-sm text-primary-foreground/80">
                {data.nextShift.slot.students
                  .map((s) => (s.subject ? `${s.name}(${s.subject})` : s.name))
                  .join(" / ")}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            <CalendarClock className="mx-auto mb-1 size-5" />
            予定された出勤はありません。
          </div>
        )}
      </section>

      {/* 今週のシフト */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          今週のシフト
        </h2>
        {data.weekRows.length > 0 ? (
          <ul className="divide-y rounded-xl border">
            {data.weekRows.map((row) => (
              <li
                key={row.date}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <div className="w-12 shrink-0 text-center">
                  <p className="text-[11px] text-muted-foreground">
                    {row.weekdayLabel}
                  </p>
                  <p className="text-sm font-semibold">{shortDate(row.date)}</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <p className="flex-1 text-sm font-medium">
                  {row.slotNumbers.map((n) => `${n}限`).join(" / ")}
                </p>
                {row.status === "absent" ? (
                  <Badge variant="destructive">欠勤</Badge>
                ) : (
                  <Badge className="border-transparent bg-green-50 text-green-700 hover:bg-green-50">
                    確定
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {data.weekPublished
              ? "今週の確定シフトはありません。"
              : "確定シフトはまだ公開されていません。"}
          </div>
        )}
      </section>
    </div>
  );
}
