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
 *
 * ⚠️ **表示された瞬間に読み上げられることは保証しない**。DOM 変更を伴わない
 * CSS アニメーション由来の live region 更新は発火が不安定で、特に iOS VoiceOver
 * (講師 UI の本命) は当てにならない (レビュー指摘)。読み上げなくても DOM には
 * 存在して可視なのでタッチ探索では到達できる = 「劣化するが壊れない」。
 *
 * 10 秒の根拠: Nielsen の応答時間の限界のうち「ユーザーが注意を保てる上限」。
 * これを超えると別の作業を始めるとされる値。
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
        <p className="font-medium">
          読み込みに時間がかかっています。もうしばらくお待ちください。
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {/*
            ⚠️ 「再読み込み」を先に書かないこと。10 秒は「壊れている」だけでなく
            「回線が遅い」でも到達するので、最初の指示が再読み込みだと**進行中の
            リクエストを捨てて振り出しに戻させる**。error.tsx の「原因を断定せず、
            誤った自己解決を促さない」方針とも噛み合わない (レビュー指摘)。
          */}
          改善しない場合は
          {/* href="" = 同じ URL へのナビゲーション (クエリは保持、fragment は落ちる)。
              location.reload() より弱い再検証だが、あちらは JS が要るので使えない */}
          <a href="" className="underline underline-offset-2">
            ページを再読み込み
          </a>
          するか、{contactLabel}にご連絡ください。
        </p>
      </div>
    </>
  );
}
