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
import { cn } from "@/lib/utils";
import { INPUT_WEEKDAYS, type InputWeekday } from "@/lib/shift-constants";
import { setSubmissionFrozen } from "./actions";
import {
  saveMonthlyConfirmation,
  saveRegularConfirmation,
} from "./confirm-actions";

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
  status: "draft" | "submitted" | "frozen";
  submittedAt: string | null;
  lastStatusChangedAt: string | null;
};

type TutorView = {
  id: string;
  displayName: string;
  email: string;
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

  // 集計: コマあたりの ○ / △ カウント
  const cellCounts = useMemo(() => {
    const counts = new Map<string, { yes: number; maybe: number }>();
    for (const w of INPUT_WEEKDAYS) {
      for (const s of slots) {
        const key = `${w.key}:${s.slotNumber}`;
        let yes = 0;
        let maybe = 0;
        for (const t of tutors) {
          const a = entryMaps.get(t.id)?.get(key);
          if (a === "yes") yes++;
          if (a === "maybe") maybe++;
        }
        counts.set(key, { yes, maybe });
      }
    }
    return counts;
  }, [tutors, slots, entryMaps]);

  function handleFreeze(tutorId: string, effectiveFrom: string, freeze: boolean) {
    setNotice(null);
    startTransition(async () => {
      const result = await setSubmissionFrozen({
        tutorId,
        effectiveFrom,
        freeze,
      });
      if (result.ok) {
        setNotice({
          type: "ok",
          text: freeze ? "凍結しました。" : "凍結を解除して下書きに戻しました。",
        });
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
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
      });
      if (result.ok) {
        setConfirmDirty(false);
        setNotice({
          type: "ok",
          text: `確定 ${result.inserted} 枠を保存しました。`,
        });
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
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
        `の全月に同じ ${assignments.length} 枠を一括確定します。\n\n` +
        `※ 適用される ${assignments.length} 枠は ${formatMonth(targetMonth)} の確定セットです。\n` +
        `他の月で月単位の調整 (月選択 → 当月確定) を入れていた場合、その調整は\n` +
        `この内容で上書きされます。\n\n` +
        `続行しますか?`,
    );
    if (!confirmed) return;
    setNotice(null);
    startTransition(async () => {
      const result = await saveRegularConfirmation({
        periodId: period.id,
        assignments,
      });
      if (result.ok) {
        setConfirmDirty(false);
        setNotice({
          type: "ok",
          text: `期全体に ${result.inserted} 枠を一括保存しました (effective_from = 期 start, effective_to = 期 end)。`,
        });
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
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
          {tutors.map((t) => {
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
                className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3"
              >
                <div className="min-w-[10rem] flex-1">
                  <div className="font-medium">{t.displayName}</div>
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

      {/* 集計マトリクス (曜日×コマ × 各講師の○/△) + C2 確定操作 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            可用性マトリクス + 確定操作 ({formatMonth(targetMonth)})
          </CardTitle>
          <CardDescription>
            日曜は教室休校のため除外。○ = 出勤可、△ = 可だが避けたい、空 = 不可
            (または未提出)。括弧内は ○ / △ の人数集計。
            <br />
            <strong>セルをクリックで確定枠をトグル</strong>。✓ = 確定済み。
            「提出済 ○ を一括取込」で初期値を作り、必要な微調整をしてから「確定保存」してください。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={bulkConfirmAllSubmittedYes}
              disabled={isPending || tutors.length === 0}
            >
              提出済 ○ を一括取込
            </Button>
            <Button
              onClick={handleSaveConfirmation}
              disabled={isPending}
              className={cn(confirmDirty && "ring-2 ring-primary/40")}
            >
              <Check className="mr-1 h-4 w-4" />
              確定保存 ({confirmedSet.size} 枠) — 当月のみ
            </Button>
            {period && (
              <Button
                variant="secondary"
                onClick={handleSaveRegularConfirmation}
                disabled={isPending}
                className={cn(confirmDirty && "ring-2 ring-primary/40")}
                title={`期「${period.label}」(${period.startDate} 〜 ${period.endDate}) の全月に一括 INSERT`}
              >
                <Check className="mr-1 h-4 w-4" />
                期一括確定 ({confirmedSet.size} 枠)
              </Button>
            )}
            {confirmDirty && (
              <span className="text-xs text-amber-700 dark:text-amber-300">
                未保存の変更があります
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-1 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card text-left text-muted-foreground">
                    曜日
                  </th>
                  <th className="text-left text-muted-foreground">コマ</th>
                  {tutors.map((t) => (
                    <th
                      key={t.id}
                      className="min-w-[3.5rem] text-center font-medium"
                    >
                      {t.displayName}
                    </th>
                  ))}
                  <th className="text-center text-muted-foreground">
                    集計 ○ / △
                  </th>
                </tr>
              </thead>
              <tbody>
                {INPUT_WEEKDAYS.flatMap((w) =>
                  slots.map((slot) => {
                    const cellKey = `${w.key as InputWeekday}:${slot.slotNumber}`;
                    const counts = cellCounts.get(cellKey);
                    return (
                      <tr key={cellKey}>
                        <th className="sticky left-0 z-10 bg-card text-left text-muted-foreground">
                          {w.label}
                        </th>
                        <th className="text-left text-muted-foreground">
                          {slot.label}
                        </th>
                        {tutors.map((t) => {
                          const a = entryMaps.get(t.id)?.get(cellKey);
                          const isYes = a === "yes";
                          const isMaybe = a === "maybe";
                          const isConfirmed = confirmedSet.has(
                            assignKey(t.id, w.key, slot.slotNumber),
                          );
                          return (
                            <td key={t.id} className="p-0">
                              <button
                                type="button"
                                onClick={() =>
                                  toggleConfirmed(
                                    t.id,
                                    w.key,
                                    slot.slotNumber,
                                  )
                                }
                                aria-label={`${t.displayName} ${w.label} ${slot.label} を確定${isConfirmed ? "解除" : ""}`}
                                disabled={isPending}
                                className={cn(
                                  "flex h-7 w-full items-center justify-center rounded border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                                  isConfirmed
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : isYes
                                      ? "border-input bg-primary/15 font-medium hover:bg-primary/25"
                                      : isMaybe
                                        ? "border-input bg-amber-100 hover:bg-amber-200 dark:bg-amber-950 dark:hover:bg-amber-900"
                                        : "border-input bg-background hover:bg-muted",
                                )}
                              >
                                {isConfirmed ? "✓" : symbolFor(a)}
                              </button>
                            </td>
                          );
                        })}
                        <td className="text-center text-muted-foreground">
                          {counts?.yes ?? 0} / {counts?.maybe ?? 0}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          {tutors.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              講師がいないためマトリクスは空です。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
