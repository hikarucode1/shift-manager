"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import type { MySwapRequest } from "@/lib/swaps";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { shortDate } from "@/lib/week";
import { SlotTime } from "@/components/slot-time";
import type { SlotTimes } from "@/lib/slot-time";
import { cn } from "@/lib/utils";
import { cancelSwapRequest } from "./actions";

const STATUS: Record<
  MySwapRequest["status"],
  { text: string; variant: "accent" | "secondary" | "destructive" | "outline" }
> = {
  pending: { text: "募集中 / 承認待ち", variant: "accent" },
  approved: { text: "成立", variant: "secondary" },
  rejected: { text: "却下", variant: "destructive" },
  cancelled: { text: "取消", variant: "outline" },
};

export function SwapPanel({
  requests,
  slotTimes,
}: {
  requests: MySwapRequest[];
  /** コマ番号 → 授業時間 */
  slotTimes: SlotTimes;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);

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
          {notice.type === "error" && <AlertCircle className="size-4" />}
          {notice.text}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            申請履歴
            <Badge variant="secondary" className="ml-2">
              {requests.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              申請履歴はありません。
            </p>
          ) : (
            <div className="divide-y">
              {requests.map((r) => {
                // #293: システムが締め切った募集は「取消」ではなく「締切」
                const st = r.closedUnassignable
                  ? { text: "締切", variant: "outline" as const }
                  : STATUS[r.status];
                return (
                  <div key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {shortDate(r.date)}（{r.weekdayLabel}） {r.slotLabel}
                        <SlotTime
                          time={slotTimes[r.slotNumber]}
                         
                        />
                      </span>
                      <Badge variant="outline">
                        {/* #215: recorded を足したので二値では嘘になる
                            (記録行が「代講募集」と出ていた) */}
                        {r.kind === "named"
                          ? `指名: ${r.nominatedName ?? "—"}`
                          : r.kind === "recorded"
                            ? "代講の記録"
                            : "代講募集"}
                      </Badge>
                      <Badge variant={st.variant}>{st.text}</Badge>
                      {/* #227: 自分で出していない募集が一覧に出るので、
                          本人の申請と区別が付くようにする */}
                      {r.kind === "recorded" ? (
                        <Badge variant="secondary">教室長が記録</Badge>
                      ) : (
                        r.isProxy && (
                          <Badge variant="secondary">教室長が募集</Badge>
                        )
                      )}
                      {/* ⚠️ 代理募集には出さない (#231)。サーバー側で塞いだので
                          押すと必ず失敗する dead button になる。#165/#178 で
                          admin 側の過去日承認について同じ判断をしている */}
                      {r.status === "pending" && !r.isProxy && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => cancelSwapRequest({ id: r.id }),
                              "申請を取り消しました。",
                            )
                          }
                        >
                          取り消し
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      理由: {r.reason}
                    </p>
                    {/* 取り消しボタンを出さない代わりに、依頼先を示す (#231)。
                        これが無いと講師は「取り下げたいがどうすればいいか」を
                        アプリ内で知る手段が無くなる */}
                    {r.status === "pending" && r.isProxy && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        この募集は教室長が作成したものです。取り下げが必要な場合は
                        教室長にご相談ください。
                      </p>
                    )}
                    {r.applicants.length > 0 && (
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        応募:{" "}
                        {r.applicants.map((a) => a.applicantName).join(", ")}
                      </p>
                    )}
                    {r.status === "approved" && r.approvedApplicantName && (
                      <p className="mt-0.5 text-sm text-primary">
                        代講者: {r.approvedApplicantName}
                      </p>
                    )}
                    {r.closedUnassignable && (
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        このコマの担当が変わって承認できなくなったため、募集は締め切られました
                      </p>
                    )}
                    {r.decisionNote && (
                      <p className="mt-0.5 text-sm text-destructive">
                        教室長より: {r.decisionNote}
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
