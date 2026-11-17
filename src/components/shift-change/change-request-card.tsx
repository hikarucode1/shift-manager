"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPen } from "lucide-react";
import { toFailedResult } from "@/lib/action-failure";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  cancelShiftChangeRequest,
  finishTrainingChange,
  requestShiftChange,
} from "@/app/tutor/shift-change-actions";

/**
 * #333: 提出期間の外でシフトを変えたいときの「変更申請」カード。
 * レギュラー・講習の提出画面の上に出す。
 */

export type ChangeRequestView =
  | { kind: "none" }
  | { kind: "pending"; id: string }
  | { kind: "approved"; unlockedUntil: string }
  | { kind: "rejected"; decisionNote: string | null };

type Target =
  | { kind: "regular" }
  | { kind: "training"; trainingPeriodId: string };

function formatUntil(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChangeRequestCard({
  target,
  state,
}: {
  target: Target;
  state: ChangeRequestView;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn().catch(toFailedResult);
      if (res.ok) {
        setReason("");
        router.refresh();
      } else {
        setError(res.error ?? "失敗しました。");
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = reason.trim();
    if (!r) {
      setError("理由を入力してください。");
      return;
    }
    run(() =>
      requestShiftChange(
        target.kind === "regular"
          ? { kind: "regular", reason: r }
          : {
              kind: "training",
              trainingPeriodId: target.trainingPeriodId,
              reason: r,
            },
      ),
    );
  }

  return (
    <Card
      className={
        state.kind === "approved" ? "border-primary/40 bg-primary/5" : undefined
      }
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardPen className="size-4" />
          {state.kind === "approved" ? "変更できます" : "変更申請"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state.kind === "approved" && (
          <>
            <p>
              教室長が変更を認めました。
              <span className="font-semibold">
                {formatUntil(state.unlockedUntil)}
              </span>
              まで変更できます。
            </p>
            {target.kind === "regular" ? (
              <p className="text-muted-foreground">
                下のコマを直したら「保存」して「提出」を押してください。提出すると変更は締め切られます。期限までに提出しないと、直した内容は捨てられて元に戻ります。
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  下のコマを直し終わったら「変更を終える」を押してください。教室長に知らせます。
                </p>
                <Button
                  className="w-full"
                  disabled={isPending}
                  onClick={() =>
                    run(() =>
                      finishTrainingChange({
                        trainingPeriodId: target.trainingPeriodId,
                      }),
                    )
                  }
                >
                  {isPending ? "送信中..." : "変更を終える"}
                </Button>
              </>
            )}
          </>
        )}

        {state.kind === "pending" && (
          <>
            <p>変更申請を出しました。教室長の承認を待っています。</p>
            <Button
              variant="outline"
              className="w-full"
              disabled={isPending}
              onClick={() =>
                run(() => cancelShiftChangeRequest({ id: state.id }))
              }
            >
              申請を取り下げる
            </Button>
          </>
        )}

        {(state.kind === "none" || state.kind === "rejected") && (
          <form className="space-y-3" onSubmit={submit}>
            {state.kind === "rejected" && (
              <p className="rounded-md bg-destructive/10 p-2 text-destructive">
                前回の変更申請は却下されました
                {state.decisionNote ? `（教室長より: ${state.decisionNote}）` : ""}
              </p>
            )}
            <p className="text-muted-foreground">
              提出期間が終わっているため、今は変更できません。変えたいときは理由を書いて申請してください。教室長が承認すると、3日間だけ変更できるようになります。
            </p>
            <textarea
              aria-label="変更したい理由"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="例: 大学の授業が変わり、水曜の夜に出られなくなったため"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "送信中..." : "変更申請を出す"}
            </Button>
          </form>
        )}

        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
