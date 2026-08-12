"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * シェルを描画できないときの全画面フォールバック (#188)。
 *
 * TutorLayout / AdminLayout は requireRole() → getProfile() で profiles を
 * 引くため、DB に到達できないと layout 自体が throw する。layout の例外は
 * 同セグメントの error.tsx では捕捉されないので (#187 で実測)、そのままだと
 * 講師 7 画面 / 管理 11 画面すべてが素の 500 になりシェルごと消える。
 * Supabase Free tier は非アクティブで自動 pause されるため、これは実際に起きる。
 *
 * 各 layout が requireRole() を try/catch し、失敗時にこれを返す。
 *
 * ⚠️ client component だが、これは reload ボタンのためだけ。本体は SSR されて
 * 最初の HTML に載るので、JS が動かない環境でもメッセージは表示される
 * (loading.tsx + error.tsx 方式だとエラー表示が hydration 依存になる = #189。
 * DB 全断はまさに #189 が刺さる場面なので、ここでは layout 捕捉を選んでいる)。
 *
 * ⚠️ この fallback は**認可の境界ではない**。layout が children を描画しなくても
 * page の出力は RSC ペイロードに載って配信される (実測済み)。認可は各 page の
 * requireRole() が担保する前提を崩さないこと。
 *
 * シェル (ヘッダー/ナビ) は profile が無いと描画できないので出せない。DB 全断中は
 * 他画面へ移動しても同じ結果になるため、導線が無いことは実害にならない。
 *
 * 文言は原因を断定しない (#184/#186 と同じ方針)。実際の障害はサーバー側のことが
 * 多く、「通信状況を確認してください」と書くと誤った自己解決を促し、障害が
 * 報告されないまま埋もれる。
 */
export function SystemUnavailable({ contactLabel }: { contactLabel: string }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-muted p-6">
      <Card role="alert" className="w-full max-w-[360px] rounded-xl shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div
            className="flex size-[46px] items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground"
            aria-hidden
          >
            S
          </div>

          <TriangleAlert className="size-5 text-muted-foreground" aria-hidden />

          <div>
            <p className="text-sm font-medium">画面を表示できませんでした。</p>
            <p className="mt-1 text-xs text-muted-foreground">
              時間をおいて再度お試しください。解消しない場合は
              {contactLabel}にご連絡ください。
            </p>
          </div>

          {/* JS が無い場合はブラウザの再読み込みが同じ役割を果たす */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            <RefreshCw aria-hidden />
            再読み込み
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
