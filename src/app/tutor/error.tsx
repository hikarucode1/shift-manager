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
 * `reset()` は同一セグメントの再レンダリングを試みるだけで、
 * router.refresh() のようにオフライン時にブラウザのハードナビへ
 * フォールバックしない (= アプリごと失わない)。
 *
 * 文言は原因を断定しない。実際の障害はサーバー側 (DB 未到達・schema 不整合)
 * のことが多く、「通信状況を確認してください」と書くとユーザーに誤った
 * 自己解決を促し、障害が報告されないまま埋もれる。digest を出して
 * 問い合わせ時の手がかりにする。
 */
export default function TutorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
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
        <Button variant="outline" size="sm" onClick={reset}>
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
