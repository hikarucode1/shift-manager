import { StalledLoadingHint } from "@/components/stalled-loading-hint";

/**
 * 管理画面セグメントの読み込み fallback (#186)。
 *
 * ⚠️ これは「見栄え」のためのファイルではない。本命は初回 SSR の 500 回避。
 *
 * Next 16.2.4 で実測した挙動 (2026-09-29 に本番ビルドで再確認、#190):
 *   - error.tsx のみ            → Server Component の throw は HTTP 500 +
 *                                 `__next_error__`。error.tsx は描画されない
 *   - error.tsx + loading.tsx   → 同じ throw が HTTP 200 + この fallback の
 *                                 HTML になり、RSC ストリームにエラーチャンク
 *                                 (`E{"digest":...}`) が乗って hydration 後に
 *                                 error.tsx が描画される
 *   - `notFound()` も同じ。loading.tsx が無ければ 404、あれば 200 +
 *     `<meta name="robots" content="noindex">`
 *   - `forbidden()` (403) は**今は使えない**。`experimental.authInterrupts`
 *     が未設定なので、呼ぶと設定エラーとして throw し、error.tsx の汎用画面
 *     (障害に見える) になる。有効にしても同じ仕組みで 200 になるはず (未実測)
 *
 * loading.tsx が Suspense 境界を作るため、throw がシェルごと落とさずに
 * 境界で受け止められる。したがって URL 直アクセス (実際の障害経路) を
 * 救うにはこの 1 枚が必須で、error.tsx とセットで意味を持つ。
 *
 * トレードオフ (承知の上。#190 で比べ直して、このまま行くと決めた):
 *   - 失敗時も HTTP 200 を返すため、監視やクローラからは成功に見える。
 *     error.tsx の `console.error` は**利用者のブラウザ**に出るだけで、
 *     運用側には届かない。サーバ側で追えるのは Vercel の関数ログだけ
 *     (layout の失敗は `reportIncident` がエラー ID 付きで残す)。
 *     `npm run check:migrations` の CI 自動化など別系統の検知が要る
 *   - 配下のページで `notFound()` を使っても 404 は返らない。**配下の
 *     ページからはステータスを決められない**ので、404 / 403 が要るルートは
 *     このセグメントの外に置くか、200 を受け入れる
 *     (layout は境界の外だが、throw せず SystemUnavailable を描画する作り
 *     なので、ステータスを返す場所には使えない。下の ⚠️ を参照)
 *   - 「エラー画面を出す」と「5xx / 404 を返す」は、このセグメント構成では
 *     両立しない。ステータスで死活を見たいなら、画面ではなく専用の
 *     エンドポイントを見る (#275。まだ無い)
 *   - 正常時もページ遷移で一瞬スケルトンが出る (従来は前の画面が残った)
 *
 * ⚠️ layout.tsx が throw する場合はこの仕組みでも救えず 500 になる
 * (同セグメントの error.tsx は layout の外側を守れないため。#187 で実測)。
 * そこで AdminLayout は requireRole() を `resolveOrIncident` で包み、失敗しても
 * throw せず SystemUnavailable を描画する (#188)。**DB 全断でも 500 にはならず
 * SystemUnavailable の「画面を表示できませんでした。」になる** (ステータスは 200 のはず。未実測)。
 * つまり**ステータスコードの監視では DB 全断も検知できない** (#275)。
 *
 * admin ページは KPI カード + 表/パネルという構成が多いので、
 * それに寄せた汎用スケルトンにしている (11 ページ共用)。
 *
 * a11y の注意点 2 つ:
 *  - 脈動は `motion-safe:` 付き。Tailwind の pulse ユーティリティ自体には
 *    reduced-motion の opt-out が無く、DB 障害時はこのスケルトンが終端の
 *    表示になり脈動が一瞬でなく延々続くため、OS 設定を尊重する必要がある
 *    (この docstring に素のクラス名を書くと Tailwind のスキャナが拾って
 *    未使用ルールを吐くので、バッククォート内でも書かない)
 *  - `role="status"` に `aria-busy="true"` を付けない。busy は「この領域の
 *    更新を保留しろ」の意味で、初手から busy のまま差し替えられる作りだと
 *    sr-only の「読み込み中」が一度も読み上げられない可能性がある
 */
export default function AdminLoading() {
  return (
    <div className="space-y-5" role="status">
      <span className="sr-only">読み込み中</span>

      {/* #189: hydration しないクライアントはここまでしか到達しない。
          CSS で 10 秒後に出す (JS は一度も走らない前提) */}
      <StalledLoadingHint contactLabel="開発者" />

      <div className="h-7 w-40 motion-safe:animate-pulse rounded bg-muted" />

      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[88px] motion-safe:animate-pulse rounded-xl bg-muted"
            aria-hidden
          />
        ))}
      </div>

      <div className="h-64 motion-safe:animate-pulse rounded-xl bg-muted" aria-hidden />
    </div>
  );
}
