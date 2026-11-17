"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import type { TutorDayOff } from "@/lib/day-offs";
import { dayOffSlotsLabel } from "@/lib/day-off-rule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { noticeDate } from "@/lib/week";
import { cancelDayOffRequest, createDayOffRequest } from "./actions";

const STATUS_LABEL: Record<
  TutorDayOff["status"],
  { text: string; variant: "secondary" | "destructive" | "outline" | "accent" }
> = {
  pending: { text: "承認待ち", variant: "accent" },
  approved: { text: "承認済み", variant: "secondary" },
  rejected: { text: "却下", variant: "destructive" },
  cancelled: { text: "取り下げ", variant: "outline" },
};

type Slot = { slotNumber: number; label: string };

export function DayOffPanel({
  firstDate,
  slots,
  history,
}: {
  /** 出せる最初の日 (これより前はもうシフトが出ている) */
  firstDate: string;
  slots: Slot[];
  history: TutorDayOff[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [picked, setPicked] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);
  const labelOf = (n: number) =>
    slots.find((s) => s.slotNumber === n)?.label ?? `${n}限`;

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
    onOk?: () => void,
  ) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn().catch(toFailedResult);
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
        onOk?.();
        router.refresh();
      } else {
        setNotice({ type: "error", text: res.error ?? "失敗しました。" });
        if (isIndeterminate(res)) router.refresh();
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) {
      setNotice({ type: "error", text: "日付を選んでください。" });
      return;
    }
    if (!allDay && picked.length === 0) {
      setNotice({ type: "error", text: "休みたいコマを選んでください。" });
      return;
    }
    if (!reason.trim()) {
      setNotice({ type: "error", text: "理由を入力してください。" });
      return;
    }
    run(
      () =>
        createDayOffRequest({
          date,
          slotNumbers: allDay ? [] : picked,
          reason: reason.trim(),
        }),
      "休み希望を出しました。教室長の承認を待っています。",
      () => {
        setDate("");
        setAllDay(true);
        setPicked([]);
        setReason("");
      },
    );
  }

  function toggle(n: number) {
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">休み希望を出す</CardTitle>
          <CardDescription>
            {noticeDate(firstDate)}
            から先の日に出せます。それより前の日はもうシフトが出ているので、出勤するコマがあれば「欠勤申請」から申請してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4 text-sm" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="day-off-date">日付</Label>
              <input
                id="day-off-date"
                type="date"
                min={firstDate}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">休みたい時間</span>
              <div className="flex gap-2">
                <ChoiceButton active={allDay} onClick={() => setAllDay(true)}>
                  終日
                </ChoiceButton>
                <ChoiceButton
                  active={!allDay}
                  onClick={() => setAllDay(false)}
                >
                  コマを選ぶ
                </ChoiceButton>
              </div>
              {!allDay && (
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {slots.map((s) => (
                    <button
                      key={s.slotNumber}
                      type="button"
                      aria-pressed={picked.includes(s.slotNumber)}
                      onClick={() => toggle(s.slotNumber)}
                      className={cn(
                        "min-h-11 rounded-md border text-sm font-medium transition-colors",
                        picked.includes(s.slotNumber)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background hover:bg-muted",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="day-off-reason">理由</Label>
              <textarea
                id="day-off-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="例: 大学の用事が入ったため"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "送信中..." : "休み希望を出す"}
            </Button>
            {notice && (
              <p
                className={
                  notice.type === "ok" ? "text-primary" : "text-destructive"
                }
              >
                {notice.text}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">出した休み希望</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {history.length === 0 && (
            <p className="text-muted-foreground">まだありません。</p>
          )}
          {history.map((h) => {
            const st = STATUS_LABEL[h.status];
            const canCancel = h.status === "pending" || h.status === "approved";
            return (
              <div
                key={h.id}
                className="space-y-1 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{noticeDate(h.date)}</span>
                  <span>{dayOffSlotsLabel(h.slotNumbers, labelOf)}</span>
                  <Badge variant={st.variant}>{st.text}</Badge>
                </div>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  理由: {h.reason}
                </p>
                {h.status === "rejected" && h.decisionNote && (
                  <p className="text-destructive">
                    教室長より: {h.decisionNote}
                  </p>
                )}
                {canCancel && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () => cancelDayOffRequest({ id: h.id }),
                        "取り下げました。",
                      )
                    }
                  >
                    取り下げる
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-10 flex-1 rounded-md border text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
