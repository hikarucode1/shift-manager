"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Snowflake, ThermometerSnowflake } from "lucide-react";
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
  targetMonth: string;
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

export function AdminSubmissionsOverview({
  targetMonth,
  slots,
  tutors,
  period,
}: {
  targetMonth: string;
  slots: Slot[];
  tutors: TutorView[];
  period: PeriodView | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

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
              提出受付: {fmtJst(period.submissionOpensAt)} 〜{" "}
              {fmtJst(period.submissionDueAt)}
            </div>
          )}
          {!period && (
            <div className="ml-2 text-xs text-muted-foreground">
              この月の提出期間は未設定 (admin /admin/submission-periods で作成)
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

      {/* 集計マトリクス (曜日×コマ × 各講師の○/△) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            可用性マトリクス ({formatMonth(targetMonth)})
          </CardTitle>
          <CardDescription>
            日曜は教室休校のため除外。○ = 出勤可、△ = 可だが避けたい、空 = 不可
            (または未提出)。括弧内は ○ / △ の人数集計。
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card text-left text-muted-foreground">
                  コマ
                </th>
                <th className="text-left text-muted-foreground">曜日</th>
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
              {slots.flatMap((slot) =>
                INPUT_WEEKDAYS.map((w) => {
                  const key = `${w.key as InputWeekday}:${slot.slotNumber}`;
                  const counts = cellCounts.get(key);
                  return (
                    <tr key={key}>
                      <th className="sticky left-0 z-10 bg-card text-left text-muted-foreground">
                        {slot.label}
                      </th>
                      <th className="text-left text-muted-foreground">
                        {w.label}
                      </th>
                      {tutors.map((t) => {
                        const a = entryMaps.get(t.id)?.get(key);
                        const isYes = a === "yes";
                        const isMaybe = a === "maybe";
                        return (
                          <td
                            key={t.id}
                            className={cn(
                              "text-center",
                              isYes && "bg-primary/15 font-medium",
                              isMaybe && "bg-amber-100 dark:bg-amber-950",
                            )}
                          >
                            {symbolFor(a)}
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
