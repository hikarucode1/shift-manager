/**
 * 読み込みが進まないときに出るヒント (#189)。
 *
 * loading.tsx + error.tsx 方式 (#186) の帰結として、**エラー表示が hydration に
 * 依存する**。JS チャンクの取得に失敗したクライアントはスケルトンのまま止まり、
 * 「画面を表示できませんでした」も再試行も連絡先も出ない。講師 UI はスマホ
 * ファーストで電車内など不安定な回線が想定に入っているのに、**この方式を入れる
 * 前はブラウザのエラーページが出ていた**ので、利用者から見た失敗のシグナルが
 * 減っていた。
 *
 * ⚠️ **JS に依存しない手段で出すこと**。
 * - `setTimeout` は使えない (hydration しないので一度も走らない)
 * - `<noscript>` は「JS 無効」にしか効かず、本命の「JS 有効だが届かない」を救えない
 * - → CSS アニメーションで遅延表示する (`globals.css` の `.stalled-hint`)
 *
 * 再読み込みも素の `<a>` にする。`window.location.reload()` は JS が要る。
 */
export function StalledLoadingHint({ contactLabel }: { contactLabel: string }) {
  return (
    <>
      <noscript>
        <div className="rounded-md border bg-muted px-3 py-2 text-sm">
          この画面には JavaScript が必要です。有効にして再度お試しください。
        </div>
      </noscript>

      <div className="stalled-hint rounded-md border bg-muted px-3 py-2 text-sm">
        <p className="font-medium">読み込みに時間がかかっています。</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {/* href="" = 同じ URL の再取得。JS 不要 */}
          <a href="" className="underline underline-offset-2">
            ページを再読み込み
          </a>
          してください。解消しない場合は{contactLabel}にご連絡ください。
        </p>
      </div>
    </>
  );
}
