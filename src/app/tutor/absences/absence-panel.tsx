"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import type { AbsenceRequestRow, UpcomingShift } from "@/lib/absences";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { cancelAbsenceRequest, createAbsenceRequest } from "./actions";

const STATUS_LABEL: Record<
  AbsenceRequestRow["status"],
  { text: string; variant: "secondary" | "destructive" | "outline" | "accent" }
> = {
  pending: { text: "承認待ち", variant: "accent" },
  approved: { text: "承認済み", variant: "secondary" },
  rejected: { text: "却下", variant: "destructive" },
  cancelled: { text: "取消", variant: "outline" },
};

export function AbsencePanel({
  upcoming,
  history,
}: {
  upcoming: UpcomingShift[];
  history: AbsenceRequestRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
    onOk?: () => void,
  ) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
        onOk?.();
        router.refresh();
      } else {
        setNotice({ type: "error", text: res.error ?? "失敗しました。" });
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sel = upcoming.find(
      (u) => `${u.date}|${u.slotNumber}` === target,
    );
    if (!sel) {
      setNotice({ type: "error", text: "対象のコマを選択してください。" });
      return;
    }
    run(
      () =>
        createAbsenceRequest({
          date: sel.date,
          slotNumber: sel.slotNumber,
          reason: reason.trim(),
        }),
      "欠勤申請を送信しました。",
      () => {
        setTarget("");
        setReason("");
      },
    );
  }

  return (
    <div className="space-y-4">
      {notice && (
        <p
          role="status"
          className={cn(
            "flex items-center gap-1 text-sm",
            notice.type === "ok" ? "text-primary" : "text-destructive",
          )}
        >
          {notice.type === "error" && <AlertCircle className="size-4" />}
          {notice.text}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">新しい欠勤申請</CardTitle>
          <CardDescription>
            申請できるのは今日以降の自分の確定シフトです。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              申請できる今後のシフトがありません。
            </p>
          ) : (
            <form className="space-y-3" onSubmit={handleSubmit}>
              <div className="space-y-1">
                <Label htmlFor="abs-target">対象コマ</Label>
                <select
                  id="abs-target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  required
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">— 選択してください —</option>
                  {upcoming.map((u) => (
                    <option
                      key={`${u.date}|${u.slotNumber}`}
                      value={`${u.date}|${u.slotNumber}`}
                    >
                      {shortDate(u.date)}（{u.weekdayLabel}） {u.slotLabel}{" "}
                      {u.startTime}〜{u.endTime}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="abs-reason">理由（必須）</Label>
                <textarea
                  id="abs-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  rows={2}
                  maxLength={500}
                  placeholder="例: 体調不良のため"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <Button type="submit" disabled={isPending}>
                {isPending ? "送信中..." : "申請する"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            申請履歴
            <Badge variant="secondary" className="ml-2">
              {history.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              申請履歴はありません。
            </p>
          ) : (
            <div className="divide-y">
              {history.map((h) => {
                const st = STATUS_LABEL[h.status];
                return (
                  <div key={h.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {shortDate(h.date)}（{h.weekdayLabel}） {h.slotLabel}
                      </span>
                      <Badge variant={st.variant}>{st.text}</Badge>
                      {h.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => cancelAbsenceRequest({ id: h.id }),
                              "申請を取り消しました。",
                            )
                          }
                        >
                          取り消し
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      理由: {h.reason}
                    </p>
                    {h.decisionNote && (
                      <p className="mt-0.5 text-sm text-destructive">
                        教室長より: {h.decisionNote}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
