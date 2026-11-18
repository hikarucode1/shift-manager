"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Snowflake, ThermometerSnowflake } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import { cn } from "@/lib/utils";
import { INPUT_WEEKDAYS, type InputWeekday } from "@/lib/shift-constants";
import { setSubmissionFrozen } from "./actions";
import {
  saveMonthlyConfirmation,
  saveRegularConfirmation,
} from "./confirm-actions";
import { SubjectFilterBar, TrackDot } from "@/components/subject-filter-bar";
import {
  NO_SUBJECT_FILTER,
  isSubjectFilterOn,
  matchFirst,
  matchesSubjectFilter,
  type SubjectFilter,
} from "@/lib/tutor-subjects";
import {
  formatPreferredStudents,
  type PreferredStudent,
} from "@/lib/preferred-students";

type Assignment = {
  tutorId: string;
  weekday: string;
  slotNumber: number;
};

type Slot = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};

type SubmissionView = {
  effectiveFrom: string;
  effectiveTo: string | null;
  desiredDays: number | null;
  desiredSlots: number | null;
  note: string | null;
  /** #319: 担当したい生徒・教科 */
  preferredStudents: PreferredStudent[];
  status: "draft" | "submitted" | "frozen";
  submittedAt: string | null;
  lastStatusChangedAt: string | null;
};

type TutorView = {
  id: string;
  displayName: string;
  email: string;
  /** #350: 文理 (未登録は null) と担当できる科目の key */
  track: string | null;
  subjects: string[];
  submission: SubmissionView | null;
  entries: Array<{
    weekday: string;
    slotNumber: number;
    availability: "yes" | "maybe" | "no";
  }>;
};

type PeriodView = {
  id: string;
  /** Issue #72 (β): 期 (regular_shift_periods) の admin 手動ラベル */
  label: string;
  /** YYYY-MM-DD (期の開始日) */
  startDate: string;
  /** YYYY-MM-DD (期の終了日) */
  endDate: string;
  submissionOpensAt: string;
  submissionDueAt: string;
};

/** "2026-07-01" → "2026年7月" */
function formatMonth(iso: string): string {
  const [y, m] = iso.split("-");
  return `${Number(y)}年${Number(m)}月`;
}

/** ISO → JST "MM/DD HH:mm" */
function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeProps(
  status: SubmissionView["status"] | "未提出",
): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  switch (status) {
    case "draft":
      return { label: "下書き", variant: "secondary" };
    case "submitted":
      return { label: "提出済み", variant: "default" };
    case "frozen":
      return { label: "凍結中", variant: "destructive" };
    case "未提出":
      return { label: "未提出", variant: "outline" };
  }
}

function symbolFor(a: "yes" | "maybe" | "no" | undefined): string {
  if (a === "yes") return "○";
  if (a === "maybe") return "△";
  return "";
}

/** (tutorId, weekday, slot) を 1 つの文字列 key にする */
function assignKey(tutorId: string, weekday: string, slot: number): string {
  return `${tutorId}:${weekday}:${slot}`;
}

export function AdminSubmissionsOverview({
  targetMonth,
  slots,
  tutors,
  initialConfirmed,
  period,
}: {
  targetMonth: string;
  slots: Slot[];
  tutors: TutorView[];
  initialConfirmed: Assignment[];
  period: PeriodView | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  // C2 #63: 確定枠 set (key = "tutorId:weekday:slot")。クリックでトグル。
  // 「確定保存」ボタンで bulk saveMonthlyConfirmation に渡し replace 保存。
  const [confirmedSet, setConfirmedSet] = useState<Set<string>>(
    () =>
      new Set(
        initialConfirmed.map((a) =>
          assignKey(a.tutorId, a.weekday, a.slotNumber),
        ),
      ),
  );
  // 初期確定セットからの変更検知 (未保存変更がある時 ボタン強調)
  const [confirmDirty, setConfirmDirty] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  // #350: 文理・科目で絞り込む。合わない人は消さずに薄くし、合う人を先頭に出す
  // (確定済みの人が見えなくなって外し忘れないように。11/18 本人)
  const [subjectFilter, setSubjectFilter] =
    useState<SubjectFilter>(NO_SUBJECT_FILTER);
  const filterOn = isSubjectFilterOn(subjectFilter);
  const isMatch = (t: TutorView) =>
    !filterOn || matchesSubjectFilter(t, subjectFilter);
  const sortedTutors = matchFirst(tutors, isMatch);

  // #361: いま見ている曜日
  const [weekday, setWeekday] = useState<InputWeekday>("mon");

  // 月選択用 input ("YYYY-MM")
  const [monthInput, setMonthInput] = useState(targetMonth.slice(0, 7));

  function applyMonth() {
    const candidate = `${monthInput}-01`;
    if (!/^\d{4}-\d{2}-01$/.test(candidate)) {
      setNotice({ type: "error", text: "対象月の形式が不正です。" });
      return;
    }
    router.push(`/admin/fixed-shifts?month=${candidate}`);
  }

  // 各 tutor の entries を Map に変換 (描画時の O(1) lookup 用)
  const entryMaps = useMemo(() => {
    const m = new Map<string, Map<string, "yes" | "maybe" | "no">>();
    for (const t of tutors) {
      const inner = new Map<string, "yes" | "maybe" | "no">();
      for (const e of t.entries) {
        inner.set(`${e.weekday}:${e.slotNumber}`, e.availability);
      }
      m.set(t.id, inner);
    }
    return m;
  }, [tutors]);

  // #361: 曜日ごとの確定数 (曜日の切り替えボタンに出す)
  const confirmedCountByWeekday = useMemo(() => {
    const m = new Map<string, number>();
    for (const key of confirmedSet) {
      const w = key.split(":")[1];
      m.set(w, (m.get(w) ?? 0) + 1);
    }
    return m;
  }, [confirmedSet]);

  function handleFreeze(tutorId: string, effectiveFrom: string, freeze: boolean) {
    setNotice(null);
    startTransition(async () => {
      const result = await setSubmissionFrozen({
        tutorId,
        effectiveFrom,
        freeze,
      }).catch(toFailedResult);
      if (result.ok) {
        setNotice({
          type: "ok",
          text: freeze ? "凍結しました。" : "凍結を解除して下書きに戻しました。",
        });
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
        // #202: reject 由来は「書いたか不明」なのでサーバーから読み直す。
        if (isIndeterminate(result)) router.refresh();
      }
    });
  }

  // C2 #63: 確定セルのトグル
  function toggleConfirmed(tutorId: string, weekday: string, slot: number) {
    const key = assignKey(tutorId, weekday, slot);
    setConfirmedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setConfirmDirty(true);
  }

  // 確定セットを Assignment[] に変換 (handleSaveConfirmation / handleSaveRegular 共通)
  function currentAssignments(): Assignment[] {
    return Array.from(confirmedSet).map((key) => {
      const [tutorId, weekday, slotStr] = key.split(":");
      return { tutorId, weekday, slotNumber: Number(slotStr) };
    });
  }

  // Issue #74 (δ): 単月の bulk 確定保存。期 (period) が紐付いていないと
  // periodId を渡せないので、当月をカバーする期が存在することが前提。
  function handleSaveConfirmation() {
    if (!period) {
      setNotice({
        type: "error",
        text: "対象月をカバーする期が見つかりません。/admin/regular-periods で先に期を作成してください。",
      });
      return;
    }
    setNotice(null);
    const assignments = currentAssignments();
    startTransition(async () => {
      const result = await saveMonthlyConfirmation({
        periodId: period.id,
        targetMonth,
        assignments,
      }).catch(toFailedResult);
      if (result.ok) {
        setConfirmDirty(false);
        setNotice({
          type: "ok",
          text: `確定 ${result.inserted} 枠を保存しました。`,
        });
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
        // #202: reject 由来は「書いたか不明」なのでサーバーから読み直す。
        if (isIndeterminate(result)) router.refresh();
      }
    });
  }

  // γ #73 + #84 (1): 期内の全月に同じ確定を一括保存。期 (period) が紐付いている時のみ可。
  // 確認モーダルでは「適用元 = 現在閲覧中の月の確定セット」を明示する。閲覧中の月以外で
  // saveMonthlyConfirmation 経由の月単位調整が入っていると、その調整が一括上書きで消える
  // ため、admin が「気付かずに別月の調整を消した」事故を起こしにくくする。
  function handleSaveRegularConfirmation() {
    if (!period) return;
    const assignments = currentAssignments();
    const confirmed = window.confirm(
      `期「${period.label}」(${period.startDate} 〜 ${period.endDate}) ` +
        `のすべての月に同じ ${assignments.length} 枠を保存します。\n\n` +
        `※ 適用される ${assignments.length} 枠は ${formatMonth(targetMonth)} の画面で ✓ を付けたものです。\n` +
        `ほかの月で「その月だけ保存」をしていた場合、その分は\n` +
        `この内容で上書きされます。\n\n` +
        `続行しますか?`,
    );
    if (!confirmed) return;
    setNotice(null);
    startTransition(async () => {
      const result = await saveRegularConfirmation({
        periodId: period.id,
        assignments,
      }).catch(toFailedResult);
      if (result.ok) {
        setConfirmDirty(false);
        setNotice({
          type: "ok",
          text: `期のすべての月に ${result.inserted} 枠を保存しました。`,
        });
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
        // #202: reject 由来は「書いたか不明」なのでサーバーから読み直す。
        if (isIndeterminate(result)) router.refresh();
      }
    });
  }

  // C2 #63: 提出済み (submitted) の ○ をすべて確定セットに取り込む補助操作
  function bulkConfirmAllSubmittedYes() {
    setConfirmedSet((prev) => {
      const next = new Set(prev);
      for (const t of tutors) {
        if (t.submission?.status !== "submitted") continue;
        for (const e of t.entries) {
          if (e.availability === "yes") {
            next.add(assignKey(t.id, e.weekday, e.slotNumber));
          }
        }
      }
      return next;
    });
    setConfirmDirty(true);
  }

  return (
    <div className="space-y-6">
      {/* 月選択 + アクティブ期間情報 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">対象月</CardTitle>
          <CardDescription>
            選択した月の effective_from を持つ提出を表示します。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="target-month">対象月</Label>
            <Input
              id="target-month"
              type="month"
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value)}
              className="w-48"
            />
          </div>
          <Button onClick={applyMonth} disabled={isPending}>
            表示
          </Button>
          {period && (
            <div className="ml-2 text-xs text-muted-foreground">
              <div>
                期: <span className="font-medium">{period.label}</span> (
                {period.startDate} 〜 {period.endDate})
              </div>
              <div>
                提出受付: {fmtJst(period.submissionOpensAt)} 〜{" "}
                {fmtJst(period.submissionDueAt)}
              </div>
            </div>
          )}
          {!period && (
            <div className="ml-2 text-xs text-muted-foreground">
              この月を含む期は未設定 (admin /admin/regular-periods で作成)
            </div>
          )}
        </CardContent>
      </Card>

      {notice && (
        <p
          role="status"
          className={cn(
            "text-sm",
            notice.type === "ok" ? "text-primary" : "text-destructive",
          )}
        >
          {notice.text}
        </p>
      )}

      {/* #350: 下の 2 つのカードに効く */}
      <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
        <p className="text-sm font-medium">文理・科目で絞り込む</p>
        <SubjectFilterBar value={subjectFilter} onChange={setSubjectFilter} />
        {filterOn && (
          <p className="text-xs text-muted-foreground">
            合う講師 {tutors.filter(isMatch).length} 人を先頭に出し、合わない講師は薄く表示しています。
          </p>
        )}
      </div>

      {/* 講師ごとのステータスカード */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            講師別ステータス ({formatMonth(targetMonth)})
          </CardTitle>
          <CardDescription>
            {tutors.length} 名中、提出済み{" "}
            {
              tutors.filter((t) => t.submission?.status === "submitted").length
            }{" "}
            名 / 下書き{" "}
            {tutors.filter((t) => t.submission?.status === "draft").length} 名 /
            凍結{" "}
            {tutors.filter((t) => t.submission?.status === "frozen").length} 名
            / 未提出{" "}
            {tutors.filter((t) => t.submission === null).length} 名
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedTutors.map((t) => {
            const status = t.submission?.status ?? "未提出";
            const badge = statusBadgeProps(status);
            const canFreeze =
              t.submission &&
              (t.submission.status === "draft" ||
                t.submission.status === "submitted");
            const canUnfreeze =
              t.submission && t.submission.status === "frozen";
            return (
              <div
                key={t.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3",
                  !isMatch(t) && "opacity-40",
                )}
              >
                <div className="min-w-[10rem] flex-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <TrackDot track={t.track} />
                    {t.displayName}
                  </div>
                  <div className="text-xs text-muted-foreground">{t.email}</div>
                </div>
                <Badge variant={badge.variant}>{badge.label}</Badge>
                {t.submission && (
                  <div className="text-xs text-muted-foreground">
                    希望: {t.submission.desiredDays ?? "-"} 日 /{" "}
                    {t.submission.desiredSlots ?? "-"} コマ
                    {t.submission.effectiveTo && (
                      <> ・終了 {t.submission.effectiveTo}</>
                    )}
                    {t.submission.submittedAt && (
                      <> ・提出 {fmtJst(t.submission.submittedAt)}</>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  {canFreeze && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        handleFreeze(t.id, t.submission!.effectiveFrom, true)
                      }
                    >
                      <Snowflake className="mr-1 h-4 w-4" />
                      凍結
                    </Button>
                  )}
                  {canUnfreeze && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        handleFreeze(t.id, t.submission!.effectiveFrom, false)
                      }
                    >
                      <ThermometerSnowflake className="mr-1 h-4 w-4" />
                      凍結解除 (下書きへ)
                    </Button>
                  )}
                </div>
                {t.submission && t.submission.preferredStudents.length > 0 && (
                  <p className="mt-1 w-full text-xs text-muted-foreground">
                    担当したい生徒:{" "}
                    {formatPreferredStudents(t.submission.preferredStudents)}
                  </p>
                )}
                {t.submission?.note && (
                  <p className="mt-1 w-full whitespace-pre-wrap text-xs text-muted-foreground">
                    📝 {t.submission.note}
                  </p>
                )}
              </div>
            );
          })}
          {tutors.length === 0 && (
            <p className="text-sm text-muted-foreground">
              アクティブな講師がいません。
            </p>
          )}
        </CardContent>
      </Card>

      {/* #361: 曜日ごとに「このコマに誰が来られるか」を名前で並べ、名前を押して
          確定する。以前の 曜日×コマ × 講師 の表は、講師が増えると横に長く、
          希望の一覧と確定の操作が混ざっていて分かりにくかった */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            出られる人と確定 ({formatMonth(targetMonth)})
          </CardTitle>
          <CardDescription>
            曜日を選ぶと、コマごとに「出られる人（○）」と「できれば避けたい人（△）」が出ます。名前を押すと確定（✓）、もう一度押すと外れます。決め終わったら下の「保存」を押してください。日曜は休校のため出ません。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="group"
            aria-label="曜日"
            className="grid grid-cols-6 gap-1 rounded-lg bg-muted p-1"
          >
            {INPUT_WEEKDAYS.map((w) => {
              const n = confirmedCountByWeekday.get(w.key) ?? 0;
              const active = weekday === w.key;
              return (
                <button
                  key={w.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setWeekday(w.key)}
                  className={cn(
                    "rounded-md px-1 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {w.label}
                  <span className="ml-0.5 text-xs text-muted-foreground">
                    {n > 0 ? `✓${n}` : ""}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            {slots.map((slot) => {
              const cellKey = `${weekday}:${slot.slotNumber}`;
              const yes = sortedTutors.filter(
                (t) => entryMaps.get(t.id)?.get(cellKey) === "yes",
              );
              const maybe = sortedTutors.filter(
                (t) => entryMaps.get(t.id)?.get(cellKey) === "maybe",
              );
              // 希望に無いのに確定している人 (前に手で入れた等) も見せる
              const others = sortedTutors.filter(
                (t) =>
                  !entryMaps.get(t.id)?.has(cellKey) ||
                  entryMaps.get(t.id)?.get(cellKey) === "no",
              );
              const confirmedOthers = others.filter((t) =>
                confirmedSet.has(assignKey(t.id, weekday, slot.slotNumber)),
              );
              const addable = others.filter(
                (t) =>
                  !confirmedSet.has(assignKey(t.id, weekday, slot.slotNumber)),
              );
              const confirmedCount = tutors.filter((t) =>
                confirmedSet.has(assignKey(t.id, weekday, slot.slotNumber)),
              ).length;
              return (
                <div
                  key={slot.slotNumber}
                  className="space-y-2 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold">{slot.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {slot.startTime}〜{slot.endTime}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      確定 {confirmedCount} 人
                    </span>
                  </div>
                  <NameRow
                    mark="○"
                    people={yes}
                    tone="yes"
                    weekday={weekday}
                    slotNumber={slot.slotNumber}
                    confirmedSet={confirmedSet}
                    disabled={isPending}
                    onToggle={toggleConfirmed}
                    isMatch={isMatch}
                  />
                  <NameRow
                    mark="△"
                    people={maybe}
                    tone="maybe"
                    weekday={weekday}
                    slotNumber={slot.slotNumber}
                    confirmedSet={confirmedSet}
                    disabled={isPending}
                    onToggle={toggleConfirmed}
                    isMatch={isMatch}
                  />
                  {confirmedOthers.length > 0 && (
                    <NameRow
                      mark="希望外"
                      people={confirmedOthers}
                      tone="other"
                      weekday={weekday}
                      slotNumber={slot.slotNumber}
                      confirmedSet={confirmedSet}
                      disabled={isPending}
                      onToggle={toggleConfirmed}
                      isMatch={isMatch}
                    />
                  )}
                  {addable.length > 0 && (
                    <select
                      aria-label={`${slot.label} にほかの講師を入れる`}
                      value=""
                      disabled={isPending}
                      onChange={(e) => {
                        if (e.target.value) {
                          toggleConfirmed(
                            e.target.value,
                            weekday,
                            slot.slotNumber,
                          );
                        }
                      }}
                      className="h-8 rounded-md border bg-background px-2 text-xs text-muted-foreground"
                    >
                      <option value="">＋ 希望に無い講師を入れる</option>
                      {addable.map((t) => (
                        <option key={t.id} value={t.id}>
                          {filterOn && isMatch(t) ? "● " : ""}
                          {t.displayName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
            {tutors.length === 0 && (
              <p className="text-sm text-muted-foreground">
                講師がいないため表示できるものがありません。
              </p>
            )}
          </div>

          <div className="space-y-3 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="space-y-1">
              <Button
                variant="outline"
                size="sm"
                onClick={bulkConfirmAllSubmittedYes}
                disabled={isPending || tutors.length === 0}
              >
                提出済みの ○ をまとめて確定にする
              </Button>
              <p className="text-xs text-muted-foreground">
                全曜日の、提出済みの人の ○ をすべて ✓ にします。そこから外したい人を押して直すと早いです。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {period && (
                <Button
                  onClick={handleSaveRegularConfirmation}
                  disabled={isPending}
                  className={cn(confirmDirty && "ring-2 ring-primary/40")}
                >
                  <Check className="mr-1 h-4 w-4" />
                  期の全部の月に保存（{confirmedSet.size} 枠）
                </Button>
              )}
              <Button
                variant={period ? "outline" : "default"}
                onClick={handleSaveConfirmation}
                disabled={isPending}
                className={cn(confirmDirty && "ring-2 ring-primary/40")}
              >
                <Check className="mr-1 h-4 w-4" />
                {formatMonth(targetMonth)}だけ保存
              </Button>
              {confirmDirty && (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  まだ保存していない変更があります
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {period
                ? `ふつうは「期の全部の月に保存」です（${period.label}: ${period.startDate} 〜 ${period.endDate} のどの月も同じ確定になります）。この月だけ違うときに「${formatMonth(targetMonth)}だけ保存」を使います。`
                : "この月を含む期がまだ無いため、保存できません。先に「レギュラー期間」で期を作ってください。"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** #361: 1 コマの ○ / △ / 希望外 の人を名前のボタンで並べる。押すと確定を切り替える */
function NameRow({
  mark,
  people,
  tone,
  weekday,
  slotNumber,
  confirmedSet,
  disabled,
  onToggle,
  isMatch,
}: {
  mark: string;
  people: TutorView[];
  tone: "yes" | "maybe" | "other";
  weekday: string;
  slotNumber: number;
  confirmedSet: Set<string>;
  disabled: boolean;
  onToggle: (tutorId: string, weekday: string, slot: number) => void;
  /** #350: 絞り込みに合う人か。合わない人は薄くする */
  isMatch: (t: TutorView) => boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          "w-10 shrink-0 pt-1 text-center text-xs font-semibold",
          tone === "yes" && "text-primary",
          tone === "maybe" && "text-amber-700 dark:text-amber-300",
          tone === "other" && "text-muted-foreground",
        )}
      >
        {mark}
      </span>
      {people.length === 0 ? (
        <span className="pt-1 text-xs text-muted-foreground">なし</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {people.map((t) => {
            const on = confirmedSet.has(assignKey(t.id, weekday, slotNumber));
            // 下書きのままの希望は、まだ本人が出していないので印を付ける
            const draft = t.submission?.status === "draft";
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onToggle(t.id, weekday, slotNumber)}
                title={draft ? "まだ提出していない下書きの希望です" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                  !isMatch(t) && "opacity-40",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : tone === "maybe"
                      ? "border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950"
                      : "border-input bg-background hover:bg-muted",
                )}
              >
                {on ? "✓" : <TrackDot track={t.track} />}
                {t.displayName}
                {draft && <span className="ml-1 opacity-70">（下書き）</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
