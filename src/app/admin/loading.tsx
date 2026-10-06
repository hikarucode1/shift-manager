import { StalledLoadingHint } from "@/components/stalled-loading-hint";

/**
 * 管理画面セグメントの読み込み fallback (#186)。
 *
 * ⚠️ これは「見栄え」のためのファイルではない。本命は初回 SSR の 500 回避。
 *
 * Next 16.2.4 で実測した挙動 (2026-09-29、本番ビルド):
 *   - error.tsx のみ            → Server Component の throw は HTTP 500 +
 *                                 `__next_error__`。error.tsx は描画されない
 *   - error.tsx + loading.tsx   → 同じ throw が HTTP 200 + この fallback の
 *                                 HTML になり、RSC ストリームにエラーチャンクが
 *                                 乗って hydration 後に error.tsx が描画される
 *   - `notFound()` も同じ。loading.tsx が無ければ 404、あれば 200 + noindex
 *
 * loading.tsx が Suspense 境界を作るため、throw がシェルごと落とさずに
 * 境界で受け止められる。したがって URL 直アクセス (実際の障害経路) を
 * 救うにはこの 1 枚が必須で、error.tsx とセットで意味を持つ。
 *
 * ⚠️ **その代わり、失敗しても HTTP 200 を返す。境界の内側 (配下の page と
 * 入れ子の layout) で `notFound()` しても 404 にならない。** #190 で比べ
 * 直して、このまま行くと決めた。403 は loading.tsx とは別の理由で今は返せない
 * (`authInterrupts` が未設定なので `forbidden()` はただの Error になる)。
 * 正常時もページ遷移で一瞬スケルトンが出る (これも承知のうえ。外すと #186
 * の 500 が戻る)。
 * 障害の種類ごとの見え方 (200 になる障害と、/login へ 307 になる障害がある)、
 * ステータスが要るときの選択肢、`forbidden()` の扱いは、変わりやすいので
 * ここに書かず #190 に置いている:
 * https://github.com/hikarucode1/shift-manager/issues/190#issuecomment-6007855661
 *
 * ⚠️ layout.tsx が throw する場合はこの仕組みでも救えず 500 になる (#187)。
 * **layout で DB を引くなら `resolveOrIncident` で包むこと** (#188。
 * `shell-guard.ts`)。入れ子の layout を足すときも同じ。
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
