/**
 * 管理画面セグメントの読み込み fallback (#186)。
 *
 * ⚠️ これは「見栄え」のためのファイルではない。本命は初回 SSR の 500 回避。
 *
 * Next 16.2.4 で実測した挙動:
 *   - error.tsx のみ            → Server Component の throw は HTTP 500 +
 *                                 `__next_error__`。error.tsx は描画されない
 *   - error.tsx + loading.tsx   → 同じ throw が HTTP 200 + この fallback の
 *                                 HTML になり、RSC ストリームにエラーチャンク
 *                                 (`E{"digest":...}`) が乗って hydration 後に
 *                                 error.tsx が描画される
 *
 * loading.tsx が Suspense 境界を作るため、throw がシェルごと落とさずに
 * 境界で受け止められる。したがって URL 直アクセス (実際の障害経路) を
 * 救うにはこの 1 枚が必須で、error.tsx とセットで意味を持つ。
 *
 * トレードオフ (承知の上):
 *   - 失敗時も HTTP 200 を返すため、監視やクローラからは成功に見える。
 *     検知は console.error 頼みになるので `npm run check:migrations` の
 *     CI 自動化など別系統の検知が要る
 *   - 正常時もページ遷移で一瞬スケルトンが出る (従来は前の画面が残った)
 *
 * ⚠️ layout.tsx が throw する場合はこの仕組みでも救えず 500 のまま
 * (同セグメントの error.tsx は layout の外側を守れないため)。
 * AdminLayout は requireRole() → getProfile() で DB を引くので、
 * DB 全断では引き続き全画面 500 になる。
 *
 * admin ページは KPI カード + 表/パネルという構成が多いので、
 * それに寄せた汎用スケルトンにしている (11 ページ共用)。
 */
export default function AdminLoading() {
  return (
    <div className="space-y-5" role="status" aria-busy="true">
      <span className="sr-only">読み込み中</span>

      <div className="h-7 w-40 animate-pulse rounded bg-muted" />

      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[88px] animate-pulse rounded-xl bg-muted"
            aria-hidden
          />
        ))}
      </div>

      <div className="h-64 animate-pulse rounded-xl bg-muted" aria-hidden />
    </div>
  );
}
