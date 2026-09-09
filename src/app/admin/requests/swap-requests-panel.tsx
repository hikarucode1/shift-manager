"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import type { AdminSwapRequest } from "@/lib/swaps";
import { pendingSwapApproval } from "@/lib/pending-swap-approval";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { avatarColor, avatarInitial } from "@/lib/avatar";
import { cancelOpenSwapOnBehalf, decideSwapRequest } from "./swap-actions";

/** 承認可否と見出しは 1 箇所で決める (#262)。画面に分岐を戻さないこと */
const approval = (r: AdminSwapRequest) =>
  pendingSwapApproval({
    isPastDate: r.isPastDate,
    requesterAssigned: r.requesterAssigned,
    isEnded: r.isEnded,
    isProxy: r.isProxy,
  });

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
  // #231: 代理募集 (教室長が作ったもの) は「却下」ではなく「取り下げ」。
  // 却下すると本人が出していない申請が却下されたことになる
  const [mode, setMode] = useState<"reject" | "withdraw">("reject");

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
          未対応の交代申請はありません。
        </p>
      ) : (
        <div className="space-y-3">
          {pending.map((r) => {
            // ⚠️ カードごとに 1 回だけ評価する。承認ボタンごとに呼ぶと
            // 見出しとボタンで別の結果を見る余地ができる
            // 応募者の map が `a` を使うので別名にする
            const ap = approval(r);
            return (
              <div key={r.id} className="space-y-3 rounded-lg border p-3.5">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                      avatarColor(r.requesterId),
                    )}
                    aria-hidden
                  >
                    {avatarInitial(r.requesterName)}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.requesterName}</span>
                      <Badge variant="accent">未対応</Badge>
                      {r.isProxy && <Badge variant="secondary">代理募集</Badge>}
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
                      placeholder={
                        mode === "withdraw"
                          ? "取り下げの理由を入力（講師と応募者に表示されます）"
                          : "却下の理由を入力（講師と応募者に表示されます）"
                      }
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
                              mode === "withdraw"
                                ? cancelOpenSwapOnBehalf({
                                    id: r.id,
                                    reason: rejectNote.trim(),
                                  })
                                : decideSwapRequest({
                                    decision: "rejected",
                                    id: r.id,
                                    decisionNote: rejectNote.trim(),
                                  }),
                            mode === "withdraw"
                              ? "募集を取り下げました。講師と応募者に通知が届きます。"
                              : "却下しました。講師と応募者に通知が届きます。",
                            () => {
                              setRejectId(null);
                              setRejectNote("");
                            },
                          )
                        }
                      >
                        {mode === "withdraw" ? "取り下げを確定" : "却下を確定"}
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
                    {/* ⚠️ **応募者の有無に関わらず出す**。見出し (heading) は
                      応募者リストの中にしか無いので、**0 件だと承認できない
                      理由がどこにも出ない**。担当が変わった募集は #259 で
                      講師の一覧から外れており新しい応募が来ないため 0 件のまま
                      固定され、しかも代理募集は講師側から取り下げられない
                      (`cancelSwapRequest` が createdBy で弾く)。閉じられるのは
                      教室長だけなので、何も出さないとこの画面の目的を外す */}
                    {ap.notice && (
                      <p className="text-xs font-medium text-destructive">
                        {ap.notice}
                      </p>
                    )}
                    {r.applicants.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        まだ応募者がいません。
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {ap.approvable && (
                          <p className="text-xs font-medium">{ap.heading}</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {r.applicants.map((a) => (
                            <Button
                              key={a.applicationId}
                              size="sm"
                              // ⚠️ 判定は `pendingSwapApproval` に集約してある。
                              // ここに `r.isPastDate ||` のような条件を書き足さ
                              // ないこと — 塞ぐ理由が増えるたびに見出しと
                              // ボタンがずれる。
                              //
                              // #165/#178: 過去日はサーバー側が弾くので落とす
                              // (押せると必ずエラーになる dead button だった)。
                              // #262: 担当が変わった募集も同じ理由で落とす。
                              // **終了しただけの同日コマは落とさない** — 応募が
                              // 付いた案件はここで承認するのが素直で、塞ぐと
                              // 記録側 (#215) へ移し替えさせる遠回りになる。
                              disabled={isPending || !ap.approvable}
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
                        setMode(r.isProxy ? "withdraw" : "reject");
                      }}
                    >
                      {r.isProxy ? "募集を取り下げる" : "却下"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
