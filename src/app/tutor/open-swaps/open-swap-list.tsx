"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import type { OpenSwap } from "@/lib/swaps";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { applyToSwap, withdrawApplication } from "@/app/tutor/swaps/actions";

export function OpenSwapList({ swaps }: { swaps: OpenSwap[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn().catch(toFailedResult);
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
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

      {swaps.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            現在、応募できる募集はありません。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {swaps.map((s) => (
            <Card key={s.id} className={cn(s.applied && "bg-muted/40")}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {shortDate(s.date)}（{s.weekdayLabel}） {s.slotLabel}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.requesterName} さんの代講
                      {s.kind === "named" && "（あなたを指名）"}
                    </p>
                  </div>
                  {s.applied ? (
                    <Badge className="shrink-0 border-transparent bg-green-50 text-green-700 hover:bg-green-50">
                      応募済み・承認待ち
                    </Badge>
                  ) : (
                    <Badge variant="accent" className="shrink-0">
                      募集中
                    </Badge>
                  )}
                </div>

                <p className="text-sm text-foreground">理由: {s.reason}</p>

                {s.applied ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () => withdrawApplication({ id: s.id }),
                        "応募を取り下げました。",
                      )
                    }
                  >
                    応募を取り下げる
                  </Button>
                ) : (
                  <>
                    <Button
                      className="w-full"
                      // #165/#178: 過去日はサーバー側が弾くので落とす (押せると
                      // 必ずエラーになる dead button だった)。**終了しただけの
                      // 同日コマは落とさない** — 実際に代わった人が応募して
                      // 記録に残すのは正当な操作なので、注意表示に留める。
                      disabled={isPending || s.isPastDate}
                      onClick={() =>
                        run(
                          () => applyToSwap({ swapRequestId: s.id }),
                          "応募しました。",
                        )
                      }
                    >
                      応募する
                    </Button>
                    {s.isPastDate ? (
                      <p className="text-center text-xs text-muted-foreground">
                        過去のコマのため応募できません
                      </p>
                    ) : (
                      s.isEnded && (
                        <p className="text-center text-xs text-muted-foreground">
                          このコマは終了しています（実際に代わった場合のみ応募してください）
                        </p>
                      )
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
