"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import type { PendingAbsence } from "@/lib/absences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { avatarColor, avatarInitial } from "@/lib/avatar";
import { decideAbsenceRequest } from "@/app/tutor/absences/actions";

export function RequestsPanel({ pending }: { pending: PendingAbsence[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
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
      const res = await fn().catch(toFailedResult);
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
        onOk?.();
        router.refresh();
      } else {
        setNotice({ type: "error", text: res.error ?? "失敗しました。" });
        // #202: reject 由来は「書いたか不明」。画面を古いまま放置せず
        // サーバーの真実を取りに行く (返り値の { ok: false } は確実に
        // 書いていないので触らない)。
        if (isIndeterminate(res)) router.refresh();
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

      {pending.length === 0 ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          未対応の欠勤申請はありません。
        </p>
      ) : (
        <div className="space-y-3">
          {pending.map((p) => (
            <div key={p.id} className="space-y-3 rounded-lg border p-3.5">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                    avatarColor(p.tutorId),
                  )}
                  aria-hidden
                >
                  {avatarInitial(p.tutorName)}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.tutorName}</span>
                    <Badge variant="accent">未対応</Badge>
                    {/* #211: 承認は塞がない (後から欠勤を登録するのは正当な実務)。
                        ただし過去のコマを承認しようとしていることは分かるように */}
                    {p.isEnded && (
                      <Badge variant="outline" className="text-[10px]">
                        実施済み
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {shortDate(p.date)}（{p.weekdayLabel}） {p.slotLabel}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    理由: {p.reason}
                  </p>
                  {/* #211: 「実施済み = 押してはいけない」と誤読されないように。
                      後から欠勤を登録するのは正当な実務なので承認してよい */}
                  {p.isEnded && (
                    <p className="text-xs text-muted-foreground">
                      終了したコマです。実際に欠勤していた場合は承認して構いません。
                    </p>
                  )}
                </div>
              </div>

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
    </div>
  );
}
