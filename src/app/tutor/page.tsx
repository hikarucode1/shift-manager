import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  MapPin,
  Megaphone,
  UserRound,
} from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import {
  getTutorHomeData,
  getTutorWeekView,
  MAX_WEEK_OFFSET,
} from "@/lib/tutor-home";
import {
  getProgressSheetUrl,
  getTutorManualUrl,
} from "@/lib/progress-sheet-db";
import {
  countUnconfirmedAnnouncements,
  TUTOR_ANNOUNCEMENTS_PATH,
} from "@/lib/announcements-db";
import { ConfirmWeekButton } from "./confirm-week-button";
import { shortDate, weekRangeLabel } from "@/lib/week";
import { cn } from "@/lib/utils";
import { deadlineLabel } from "@/lib/deadline";
import { Badge } from "@/components/ui/badge";
import { SlotTime } from "@/components/slot-time";
import { slotTimeRange } from "@/lib/slot-time";
import { UNDECIDED_HINT, UNDECIDED_LABEL } from "@/lib/undecided-slot";
import { TUTOR_SCHEDULES_PATH } from "@/lib/monthly-schedule";

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

/** 「山田(英) / 佐藤(数)」の形。科目が空なら名前だけ */
function formatStudents(
  list: { name: string; subject: string; isTrial?: boolean }[],
): string {
  return list
    .map(
      (s) =>
        (s.isTrial ? "【体験】" : "") +
        (s.subject ? `${s.name}(${s.subject})` : s.name),
    )
    .join(" / ");
}

/** #335: 体験授業の生徒・研修コマに付ける小さな印 */
function TrialBadge() {
  return (
    <span className="mr-0.5 rounded bg-rose-100 px-1 text-[10px] font-semibold text-rose-700">
      体験
    </span>
  );
}

/** 室長レビュー要望9: 生徒も研修も体験も入っていないコマ */
function UndecidedNote() {
  return (
    <span className="flex items-center gap-1.5 self-center">
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
        {UNDECIDED_LABEL}
      </span>
      <span className="text-xs text-muted-foreground">{UNDECIDED_HINT}</span>
    </span>
  );
}

function TrainingBadge() {
  return (
    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700">
      研修
    </span>
  );
}

/** 室長レビュー要望8: ?week=1 で来週、2 で再来週…。範囲外や数字でないときは今週 */
function parseWeekOffset(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, MAX_WEEK_OFFSET);
}

function weekHeading(offset: number, range: { start: string; end: string }) {
  const label = weekRangeLabel(range);
  if (offset === 0) return `今週のシフト（${label}）`;
  if (offset === 1) return `来週（${label}）`;
  if (offset === 2) return `再来週（${label}）`;
  return `${label} の週`;
}

export default async function TutorHome({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { profile } = await requireRole("tutor");
  const weekOffset = parseWeekOffset((await searchParams).week);
  const [
    data,
    progressSheetUrl,
    [teaching],
    unconfirmedAnnouncements,
    otherWeek,
    tutorManualUrl,
  ] = await Promise.all([
    getTutorHomeData(profile.id),
    // #339: 教室長が登録した進行表 (スプレッドシート)
    getProgressSheetUrl(),
    // #348: 文理・担当できる科目を登録済みか
    db
      .select({
        track: profiles.track,
        teachableSubjects: profiles.teachableSubjects,
      })
      .from(profiles)
      .where(eq(profiles.id, profile.id))
      .limit(1),
    // 教室長からのお知らせで、まだ「確認しました」を押していない数
    countUnconfirmedAnnouncements(profile.id),
    // 要望8: 来週以降を開いたときだけ、その週を読む
    weekOffset > 0 ? getTutorWeekView(profile.id, weekOffset) : null,
    // 室長レビュー要望13: 教室長が登録した講師マニュアル (スプレッドシート)
    getTutorManualUrl(),
  ]);
  const shownWeek = otherWeek ?? {
    offset: 0,
    range: data.weekRange,
    published: data.weekPublished,
    rows: data.weekRows,
    slotCount: data.weekSlotCount,
  };
  const needsTeachingProfile =
    !teaching?.track || (teaching.teachableSubjects ?? []).length === 0;

  // hero の締切 / アラートはどちらも「編集可能・未提出」の最も近い締切を使う
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
            <p className="text-xs text-primary-foreground/70">
              今週のコマ
              {/* #337: 日曜は「今日で終わる週」を指すので期間を添える */}
              <span className="ml-1">（{weekRangeLabel(data.weekRange)}）</span>
            </p>
            <p className="mt-0.5 text-2xl font-bold">
              {data.weekSlotCount}
              <span className="ml-1 text-sm font-normal">コマ</span>
            </p>
          </div>
          <div className="rounded-lg bg-primary-foreground/10 p-3">
            <p className="text-xs text-primary-foreground/70">提出締切</p>
            {/* 行動を促す未提出の最近接締切を表示 (提出済みは accent 強調しない) */}
            {alertDeadline ? (
              <p
                className={cn(
                  "mt-0.5 text-2xl font-bold",
                  deadlineLabel(alertDeadline.daysLeft).urgent && "text-accent",
                )}
              >
                {deadlineLabel(alertDeadline.daysLeft).text}
              </p>
            ) : (
              <p className="mt-1.5 text-lg font-semibold text-primary-foreground/90">
                {data.deadlines.length > 0 ? "提出済み" : "—"}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 教室長からのお知らせ (未確認があるときだけ一番上に出す) */}
      {unconfirmedAnnouncements > 0 && (
        <Link
          href={TUTOR_ANNOUNCEMENTS_PATH}
          className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/10 p-3 transition-colors hover:bg-accent/15"
        >
          <Megaphone className="size-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              教室長からのお知らせが {unconfirmedAnnouncements} 件あります
            </p>
            <p className="text-xs text-muted-foreground">
              読んで「確認しました」を押してください
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {/* #348: 担当できる科目が未登録ならマイページへ */}
      {needsTeachingProfile && (
        <Link
          href="/tutor/me"
          className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 transition-colors hover:bg-primary/10"
        >
          <UserRound className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              担当できる科目を登録してください
            </p>
            <p className="text-xs text-muted-foreground">
              理系・文系と、教えられる科目をマイページで選びます
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

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
        <h2 className="text-sm font-semibold text-muted-foreground">
          次の出勤
        </h2>
        {data.nextShift ? (
          <div className="rounded-xl bg-primary p-4 text-primary-foreground">
            <div className="flex items-center justify-between">
              <span className="text-sm text-primary-foreground/80">
                {dayLabel(data.nextShift)} {shortDate(data.nextShift.date)}（
                {data.nextShift.weekdayLabel}）
              </span>
              {data.nextShift.slot.seatNumber && (
                <Badge variant="accent">
                  <MapPin className="size-3" />
                  座席 {data.nextShift.slot.seatNumber}
                </Badge>
              )}
            </div>
            <p className="mt-2 text-2xl font-bold">
              {data.nextShift.slot.label}{" "}
              <span className="text-lg font-medium">
                {data.nextShift.slot.startTime}–{data.nextShift.slot.endTime}
              </span>
              {data.nextShift.slot.isTraining && (
                <span className="ml-2 align-middle">
                  <TrainingBadge />
                </span>
              )}
            </p>
            {data.nextShift.slot.students.length > 0 && (
              <p className="mt-1 text-sm text-primary-foreground/80">
                {formatStudents(data.nextShift.slot.students)}
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

      {/* 今週のシフト (要望8: 前後の週へ動ける) */}
      <section id="week" className="scroll-mt-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {weekHeading(shownWeek.offset, shownWeek.range)}
          </h2>
          <div className="flex shrink-0 gap-1">
            {shownWeek.offset > 0 && (
              <Link
                href={
                  shownWeek.offset === 1
                    ? "/tutor#week"
                    : `/tutor?week=${shownWeek.offset - 1}#week`
                }
                aria-label="前の週"
                className="inline-flex h-9 items-center rounded-md border px-2 text-xs hover:bg-muted"
              >
                <ChevronLeft className="size-4" />
                前の週
              </Link>
            )}
            {shownWeek.offset < MAX_WEEK_OFFSET && (
              <Link
                href={`/tutor?week=${shownWeek.offset + 1}#week`}
                aria-label="次の週"
                className="inline-flex h-9 items-center rounded-md border px-2 text-xs hover:bg-muted"
              >
                次の週
                <ChevronRight className="size-4" />
              </Link>
            )}
          </div>
        </div>
        {shownWeek.rows.length > 0 ? (
          <ul className="divide-y rounded-xl border">
            {shownWeek.rows.map((row) => (
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
                <div className="w-px self-stretch bg-border" />
                {/* #336: コマごとに担当する生徒を全部出す */}
                <ul className="min-w-0 flex-1 space-y-1">
                  {row.slots.map((slot) => (
                    // 授業時間を足したので、生徒が並びきらないときは次の行に送る
                    <li
                      key={slot.slotNumber}
                      className="flex flex-wrap items-baseline gap-x-2 text-sm"
                    >
                      <span className="shrink-0 font-medium">{slot.label}</span>
                      <SlotTime
                        time={slotTimeRange(slot.startTime, slot.endTime)}
                        className="shrink-0"
                      />
                      {slot.isTraining && slot.students.length === 0 ? (
                        <span className="self-center">
                          <TrainingBadge />
                        </span>
                      ) : slot.students.length > 0 ? (
                        // 名前の途中で折り返さない (1 人ずつ改行させる)
                        <span className="flex min-w-0 flex-wrap gap-x-2 text-muted-foreground">
                          {slot.students.map((st, i) => (
                            <span key={i} className="whitespace-nowrap">
                              {st.isTrial && <TrialBadge />}
                              {formatStudents([{ ...st, isTrial: false }])}
                            </span>
                          ))}
                        </span>
                      ) : (
                        // 室長レビュー要望9: 生徒も研修も体験も無いコマ
                        <UndecidedNote />
                      )}
                    </li>
                  ))}
                </ul>
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
            {shownWeek.published
              ? `${shownWeek.offset === 0 ? "今週" : "この週"}の確定シフトはありません。`
              : "確定シフトはまだ公開されていません。"}
          </div>
        )}
        {/* #317: LINE のスタンプの代わり。シフトがある週だけ出す */}
        {shownWeek.offset === 0 && shownWeek.rows.length > 0 && (
          <ConfirmWeekButton
            weekStart={data.weekRange.start}
            confirmedAt={data.weekConfirmedAt}
          />
        )}
      </section>

      {/* #339: 進行表 (教室長が登録したときだけ出す) */}
      {progressSheetUrl && (
        <a
          href={progressSheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
        >
          <ExternalLink className="size-5 shrink-0 text-primary" />
          <span className="flex-1 text-sm font-medium">進行表を開く</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </a>
      )}

      {/* 室長レビュー要望13: 講師マニュアル (教室長が登録したときだけ出す) */}
      {tutorManualUrl && (
        <a
          href={tutorManualUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
        >
          <BookOpen className="size-5 shrink-0 text-primary" />
          <span className="flex-1 text-sm font-medium">講師マニュアル</span>
          <ExternalLink className="size-4 text-muted-foreground" />
        </a>
      )}

      {/* 過去のお知らせもいつでも読み返せるように */}
      <Link
        href={TUTOR_ANNOUNCEMENTS_PATH}
        className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
      >
        <Megaphone className="size-5 shrink-0 text-primary" />
        <span className="flex-1 text-sm font-medium">教室長からのお知らせ</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>

      {/* 室長レビュー要望12: 月のスケジュール (PDF) */}
      <Link
        href={TUTOR_SCHEDULES_PATH}
        className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
      >
        <FileText className="size-5 shrink-0 text-primary" />
        <span className="flex-1 text-sm font-medium">月のスケジュール</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
    </div>
  );
}
