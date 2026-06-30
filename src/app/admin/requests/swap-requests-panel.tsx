"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { AdminSwapRequest } from "@/lib/swaps";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { avatarColor, avatarInitial } from "@/lib/avatar";
import { decideSwapRequest } from "./swap-actions";

export function SwapRequestsPanel({
  pending,
}: {
  pending: AdminSwapRequest[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
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

      {pending.length === 0 ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          未対応の交代申請はありません。
        </p>
      ) : (
        <div className="space-y-3">
          {pending.map((r) => (
            <div key={r.id} className="space-y-3 rounded-lg border p-3.5">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                    avatarColor(r.requesterName),
                  )}
                  aria-hidden
                >
                  {avatarInitial(r.requesterName)}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.requesterName}</span>
                    <Badge variant="accent">未対応</Badge>
                    <Badge variant="outline">
                      {r.kind === "named"
                        ? `指名: ${r.nominatedName ?? "—"}`
                        : "代講募集"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {shortDate(r.date)}（{r.weekdayLabel}） {r.slotLabel}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    理由: {r.reason}
                  </p>
                </div>
              </div>

              {rejectId === r.id ? (
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
                            decideSwapRequest({
                              decision: "rejected",
                              id: r.id,
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
                <div className="space-y-2">
                  {r.applicants.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      まだ応募者がいません。
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs font-medium">
                        応募者から代講者を選んで承認:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {r.applicants.map((a) => (
                          <Button
                            key={a.applicationId}
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () =>
                                  decideSwapRequest({
                                    decision: "approved",
                                    id: r.id,
                                    applicationId: a.applicationId,
                                  }),
                                `${a.applicantName} を代講者として承認しました。`,
                              )
                            }
                          >
                            {a.applicantName} を承認
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      setRejectId(r.id);
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
