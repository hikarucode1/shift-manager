"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import type { SwapHistory } from "@/lib/swaps";
import { Badge } from "@/components/ui/badge";
import { toFailedResult, isIndeterminate } from "@/lib/action-failure";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { cancelApprovedSwap } from "./swap-actions";

/**
 * 承認済みの交代・代講と、その取り消し (#213)。
 *
 * 承認後に代講が流れた (B が結局来なかった / 選び間違えた / 編成が変わった) とき、
 * これが無いと記録を実態へ戻す手段が無い。取り消しは weekly_shifts を元講師へ
 * 戻すので、**却下と同じく理由を必須**にしている。
 */
export function ApprovedSwapsPanel({
  history,
  readOnly = false,
}: {
  history: SwapHistory;
  /** 取り消し済みタブ。閲覧のみ (#213: 理由が write-only にならないように) */
  readOnly?: boolean;
}) {
  const approved = history.rows;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  function submit(id: string) {
    const trimmed = reason.trim();
    if (!trimmed) {
      setNotice({ type: "error", text: "取り消し理由を入力してください。" });
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const res = await cancelApprovedSwap({ id, reason: trimmed }).catch(
        toFailedResult,
      );
      if (!res.ok) {
        setNotice({ type: "error", text: res.error });
        if (isIndeterminate(res)) router.refresh();
        return;
      }
      setNotice({
        type: "ok",
        text:
          res.expiredAbsences > 0
            ? "取り消しました。このコマの欠勤申請が交代成立時に自動失効しています。必要なら講師に再申請を依頼してください。"
            : "取り消しました。担当を元の講師に戻しました。",
      });
      setOpenId(null);
      setReason("");
      router.refresh();
    });
  }

  if (approved.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {readOnly
            ? "取り消した交代・代講はありません。"
            : "承認済みの交代・代講はありません。"}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
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

      {!readOnly && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          取り消すと、そのコマの担当を元の講師に戻します。実際に代講が入った場合は
          取り消さないでください（週次シフト表が実態と食い違います）。
        </p>
      )}

      {history.truncated > 0 && (
        <p className="text-xs text-muted-foreground">
          直近 {approved.length} 件のみ表示しています（これより古いものは
          出ていません）。
        </p>
      )}

      {approved.map((r) => (
        <Card key={r.id}>
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <span>
                {r.date}（{r.weekdayLabel}）{r.slotLabel}
              </span>
              {/* #213: 実施済みかどうかは判断の前提。取得済みなのに出していないと
                  「来週の予定の取り消し」と見た目で区別が付かない */}
              {r.isEnded && (
                <Badge variant="outline" className="text-[10px]">
                  実施済み
                </Badge>
              )}
            </p>
            <p className="text-muted-foreground">
              {r.requesterName} → {r.approvedApplicantName ?? "不明"}
            </p>
            <p className="text-xs text-muted-foreground">理由: {r.reason}</p>
            {readOnly && r.decisionNote && (
              <p className="text-xs text-muted-foreground">
                取り消し理由: {r.decisionNote}
              </p>
            )}

            {readOnly ? null : openId === r.id ? (
              <div className="space-y-2">
                <label className="block text-xs" htmlFor={`cancel-${r.id}`}>
                  取り消し理由（必須）
                </label>
                <textarea
                  id={`cancel-${r.id}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {r.requesterName} さんを担当に戻し、{r.approvedApplicantName ?? "代講者"}{" "}
                  さんの代講記録を消します。
                  {r.isEnded &&
                    "このコマは既に終了しているため、取り消すと元に戻せません。"}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isPending || !reason.trim()}
                    onClick={() => submit(r.id)}
                  >
                    取り消す
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => {
                      setOpenId(null);
                      setReason("");
                    }}
                  >
                    やめる
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setOpenId(r.id);
                  setReason("");
                  setNotice(null);
                }}
              >
                この代講を取り消す
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
