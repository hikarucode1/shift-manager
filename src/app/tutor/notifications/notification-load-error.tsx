"use client";

import { useRouter } from "next/navigation";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 通知の取得に失敗したときの表示 (#184)。
 *
 * 文言は原因を断定しない。実際の失敗はサーバー側 (DB 未到達・schema 不整合)
 * のことが多く、「通信状況を確認してください」と書くとユーザーに誤った
 * 自己解決を促し、障害が報告されないまま埋もれる (2026-07-30 の 9 日間の
 * 通知機能停止がまさにそれ)。教室長への連絡導線を残して報告経路にする。
 *
 * ボタンは押下中も disabled にしない。disabled 化するとフォーカス中の要素から
 * フォーカスが外れ (body に落ち)、キーボード/スクリーンリーダー利用者が
 * 再試行のたびに先頭から Tab し直すことになるため。
 */
export function NotificationLoadError() {
  const router = useRouter();

  return (
    <Card role="alert" aria-live="assertive">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <TriangleAlert className="size-6 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">通知を読み込めませんでした。</p>
          <p className="mt-1 text-xs text-muted-foreground">
            時間をおいて再度お試しください。解消しない場合は教室長にご連絡ください。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.refresh()}>
          <RefreshCw aria-hidden />
          再試行
        </Button>
      </CardContent>
    </Card>
  );
}
