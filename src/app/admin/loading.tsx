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
 *
 * 実測していない (コードから読んだ) こと:
 *   - `forbidden()` (403) は**今は使えない**。`experimental.authInterrupts`
 *     が未設定なので、呼ぶと**ただの Error** として throw する
 *     (node_modules の forbidden.js で確認)。page から呼ぶと error.tsx の
 *     汎用画面、layout の権限確認 (`resolveOrIncident` の中) から呼ぶと
 *     握り潰されて SystemUnavailable + エラー ID になるはず。どちらも障害に
 *     見える。有効にしても page からなら同じ仕組みで 200 になるはず
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
 *     別系統の検知が要る — migration の未適用は `check-migrations.yml`
 *     (#204 / #206。main への push と毎日の cron) が既に見ている。
 *     死活は #275 のエンドポイント (まだ無い)
 *   - 配下のページで `notFound()` を使っても 404 は返らない。**この境界の
 *     内側からはステータスを決められない** (入れ子の layout も内側)。
 *     ステータスが要るときの選択肢:
 *     - **ルートグループで境界の外に出す**。loading.tsx / error.tsx を
 *       `admin/(guarded)/` に移し、ステータスが要るルートを `admin/(plain)/`
 *       に置けば、URL も AdminLayout (ヘッダとナビ) も変わらない。
 *       個別の項目の 404 (例: 存在しない講師の詳細) はこれ
 *     - AdminLayout で `notFound()` / `redirect()` する。境界の外で、
 *       `resolveOrIncident` もこの 2 つは握り潰さず投げ直す
 *       (`unstable_rethrow`, shell-guard.test.ts で固定)。ただし AdminLayout
 *       は子の `[id]` を受け取れないので、**セグメント全体で決まる判断 (認可
 *       など) に限る**。権限不足の `redirect()` は今も requireRole がここで
 *       使っている経路 (返るステータスを curl では測っていない)
 *     - 200 を受け入れる
 *   - ステータスで死活を見たいなら、画面ではなく専用のエンドポイントを見る
 *     (#275。まだ無い)
 *   - 正常時もページ遷移で一瞬スケルトンが出る (従来は前の画面が残った)
 *
 * ⚠️ layout.tsx が throw する場合はこの仕組みでも救えず 500 になる
 * (同セグメントの error.tsx は layout の外側を守れないため。#187 で実測)。
 * そこで AdminLayout は requireRole() を `resolveOrIncident` で包み、失敗しても
 * throw せず SystemUnavailable を描画する (#188。詳しくは `shell-guard.ts`)。
 * その結果、障害の種類で見え方が違う (詳しくは `system-unavailable.tsx`):
 *   - **DB だけの障害**: 500 にはならず、200 + SystemUnavailable のはず
 *     (ステータスは未実測)。**ステータスコードの監視では検知できない**
 *   - **認証 API が 401 / 404 を返す形の停止** (ゲートウェイ型の pause 等):
 *     「ログアウト」と区別できず、middleware が /login へ 307 する
 * #275 の監視は、どちらか一方だけを見ると他方を見落とす。また SystemUnavailable
 * の文言「画面を表示できませんでした。」は error.tsx や `/` `/login` でも出るので、
 * **文言を目印にしない**こと (どの層の失敗か区別できない)
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
