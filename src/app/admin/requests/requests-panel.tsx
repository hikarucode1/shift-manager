"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { PendingAbsence } from "@/lib/absences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { decideAbsenceRequest } from "@/app/tutor/absences/actions";

export function RequestsPanel({ pending }: { pending: PendingAbsence[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);
  // 却下入力中の行 id → 理由
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

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
          {notice.type === "error" ? (
            <AlertCircle className="size-4" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {notice.text}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            欠勤申請（未対応）
            <Badge variant="accent" className="ml-2">
              {pending.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              未対応の申請はありません。
            </p>
          ) : (
            <div className="divide-y">
              {pending.map((p) => (
                <div key={p.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.tutorName}</span>
                    <span className="text-sm">
                      {shortDate(p.date)}（{p.weekdayLabel}） {p.slotLabel}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    理由: {p.reason}
                  </p>

                  {rejectId === p.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder="却下の理由を入力（講師に表示されます）"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isPending || !rejectNote.trim()}
                          onClick={() =>
                            run(
                              () =>
                                decideAbsenceRequest({
                                  id: p.id,
                                  decision: "rejected",
                                  decisionNote: rejectNote.trim(),
                                }),
                              "却下しました。",
                              () => {
                                setRejectId(null);
                                setRejectNote("");
                              },
                            )
                          }
                        >
                          却下を確定
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRejectId(null);
                            setRejectNote("");
                          }}
                        >
                          やめる
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          run(
                            () =>
                              decideAbsenceRequest({
                                id: p.id,
                                decision: "approved",
                              }),
                            "承認しました。",
                          )
                        }
                      >
                        承認
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => {
                          setRejectId(p.id);
                          setRejectNote("");
                        }}
                      >
                        却下
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
