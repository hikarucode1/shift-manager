"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 管理画面のエラー境界 (#186、#184 のフォロー)。
 *
 * admin の各ページも `await get*()` で DB を直接叩いており、これが無いと
 * DB 障害や render 中の例外がページ全体のエラー画面 (500 相当) になり、
 * ヘッダーも横ナビも失われて他の画面へ移動する手段が消える。
 * 講師側で 2026-07-30 に起きた障害 (migration 0029 未適用) と同じ構図。
 *
 * layout.tsx (AdminShell = ヘッダー/横ナビ) はこの境界の外なので、
 * ここが描画されてもシェルは生き残る。
 *
 * ⚠️ この境界だけでは URL 直アクセス (初回 SSR) の 500 は防げない。
 * 同セグメントの loading.tsx が Suspense 境界を作ることで初めて
 * 初回ロードでも描画される (Next 16.2.4 で実測)。両者はセット。
 *
 * 文言は tutor 版と同じく原因を断定しない。実際の障害はサーバー側
 * (DB 未到達・schema 不整合) のことが多く、「通信状況を確認してください」と
 * 書くとユーザーに誤った自己解決を促し、障害が報告されないまま埋もれる。
 * 講師版と違い連絡先は教室長ではなく開発者にする (教室長自身が使う画面)。
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("admin route error", error);
  }, [error]);

  return (
    // role="alert" は暗黙に aria-live="assertive" を持つので併記しない
    <Card role="alert" className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <TriangleAlert className="size-6 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">画面を表示できませんでした。</p>
          <p className="mt-1 text-xs text-muted-foreground">
            時間をおいて再度お試しください。解消しない場合は、下のエラーIDを添えて開発者にご連絡ください。
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
