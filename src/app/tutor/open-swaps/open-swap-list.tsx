"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
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
      const res = await fn();
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
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
            <Card key={s.id}>
              <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {shortDate(s.date)}（{s.weekdayLabel}） {s.slotLabel}
                    </span>
                    <Badge variant="outline">
                      {s.kind === "named" ? "あなたを指名" : "代講募集"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    依頼: {s.requesterName} ／ 理由: {s.reason}
                  </p>
                </div>
                {s.applied ? (
                  <Button
                    variant="outline"
                    size="sm"
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
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () => applyToSwap({ swapRequestId: s.id }),
                        "応募しました。",
                      )
                    }
                  >
                    応募する
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
