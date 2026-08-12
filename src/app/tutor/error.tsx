"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 講師画面のエラー境界 (#184)。
 *
 * これが無かったため、DB 障害や render 中の例外がそのままページ全体の
 * エラー画面 (500 相当) になり、hero もヘッダーもボトムナビも失われていた
 * (2026-07-30 に本番で migration 0029 未適用のまま稼働していた際、
 * /tutor/notifications がこの状態だった)。
 *
 * layout.tsx (TutorShell = ヘッダー/ボトムナビ) はこの境界の外なので、
 * ここが描画されてもシェルは生き残り、他の画面へ移動できる。
 *
 * ⚠️ 再試行に使うのは `reset` ではなく `unstable_retry`。Next 16.2.4 の
 * `reset` は `setState({error: null})` するだけで RSC ペイロードを取り直さず
 * (error-boundary.js:39-42)、キャッシュ済みの失敗セグメントを再レンダリング
 * して即座に同じ例外を投げるため、ボタンが無反応にしか見えない。
 * `unstable_retry` は `startTransition` の中で `router.refresh()` してから
 * reset する (同:43-47) ので、DB 復旧後に押せば実際に回復する。
 *
 * 文言は原因を断定しない。実際の障害はサーバー側 (DB 未到達・schema 不整合)
 * のことが多く、「通信状況を確認してください」と書くとユーザーに誤った
 * 自己解決を促し、障害が報告されないまま埋もれる。digest を出して
 * 問い合わせ時の手がかりにする。
 */
export default function TutorError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("tutor route error", error);
  }, [error]);

  return (
    <Card role="alert" aria-live="assertive">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <TriangleAlert className="size-6 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">画面を表示できませんでした。</p>
          <p className="mt-1 text-xs text-muted-foreground">
            時間をおいて再度お試しください。解消しない場合は教室長にご連絡ください。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={unstable_retry}>
          <RefreshCw aria-hidden />
          再試行
        </Button>
        {error.digest && (
          <p className="text-[10px] text-muted-foreground">
            エラーID: {error.digest}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
