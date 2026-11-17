"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toFailedResult } from "@/lib/action-failure";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { decideShiftChange } from "./shift-change-actions";

/**
 * #333: 提出期間外のシフト変更申請。承認すると、その講師だけ 3 日間
 * 希望を直せるようになる (中身は講師があとで入れ直す)。
 */

export type ShiftChangeRow = {
  id: string;
  tutorName: string;
  kind: "regular" | "training";
  targetLabel: string | null;
  reason: string;
  /** 表示用 (JST) */
  createdAtLabel: string;
};

export function ShiftChangePanel({ pending }: { pending: ShiftChangeRow[] }) {
  if (pending.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          未対応の変更申請はありません。
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {pending.map((r) => (
        <ShiftChangeItem key={r.id} row={r} />
      ))}
    </div>
  );
}

function ShiftChangeItem({ row }: { row: ShiftChangeRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res = await decideShiftChange({
        id: row.id,
        decision,
        note: decision === "rejected" ? note.trim() : undefined,
      }).catch(toFailedResult);
      if (res.ok) router.refresh();
      else setError(res.error ?? "失敗しました。");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-2 pt-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.tutorName}</span>
          <Badge variant="outline">
            {row.kind === "regular" ? "レギュラー" : "講習"}
            {row.targetLabel ? `: ${row.targetLabel}` : ""}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {row.createdAtLabel}
          </span>
        </div>
        <p className="whitespace-pre-wrap">理由: {row.reason}</p>
        <p className="text-xs text-muted-foreground">
          承認すると、この講師だけ3日間希望を直せるようになります。直したあと本人が出し直すと通知が届きます（レギュラーは期限までに出し直さないと元に戻ります）。
        </p>

        {rejecting ? (
          <div className="space-y-2">
            <textarea
              aria-label="却下の理由"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="却下の理由（講師に届きます）"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={isPending || !note.trim()}
                onClick={() => decide("rejected")}
              >
                却下する
              </Button>
              <Button
                variant="ghost"
                disabled={isPending}
                onClick={() => setRejecting(false)}
              >
                やめる
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button disabled={isPending} onClick={() => decide("approved")}>
              {isPending ? "処理中..." : "承認する"}
            </Button>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => setRejecting(true)}
            >
              却下
            </Button>
          </div>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
