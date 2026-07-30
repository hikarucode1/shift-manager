"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 通知の取得に失敗したときの表示 (#184)。
 *
 * 従来は `getNotifications` の失敗がそのまま throw され、error boundary が
 * 無いためページごとエラー画面になっていた (2026-07-30 に本番で migration 0029
 * 未適用のまま稼働していた際、この経路が 500 になっていた)。ベル側は
 * `.catch(() => {})` で無症状にする設計 (#168) なので、一覧側は逆に
 * 「読めなかった」ことを伝えて再試行導線を出す。
 */
export function NotificationLoadError() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <WifiOff className="size-6 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">通知を読み込めませんでした。</p>
          <p className="mt-1 text-xs text-muted-foreground">
            通信状況をご確認のうえ、再読み込みしてください。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => startTransition(() => router.refresh())}
        >
          <RefreshCw className={isPending ? "animate-spin" : undefined} />
          {isPending ? "再読み込み中…" : "再読み込み"}
        </Button>
      </CardContent>
    </Card>
  );
}
