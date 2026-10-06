import { StalledLoadingHint } from "@/components/stalled-loading-hint";

/**
 * 管理画面セグメントの読み込み fallback (#186)。
 *
 * ⚠️ これは「見栄え」のためのファイルではない。本命は初回 SSR の 500 回避。
 *
 * loading.tsx が Suspense 境界を作るため、配下の throw がシェルごと落とさずに
 * 境界で受け止められ、error.tsx に落ちる (#186)。URL 直アクセス (実際の障害
 * 経路) を救うにはこの 1 枚が必須で、error.tsx とセットで意味を持つ。
 *
 * ⚠️ **その代わり、境界の内側 (配下の page と入れ子の layout) では、失敗しても
 * HTTP 200 を返し、`notFound()` の 404 や `redirect()` の 307 も返らない。**
 * 正常時もページ遷移で一瞬スケルトンが出る。#190 で比べ直して、承知のうえで
 * 残すと決めた (外すと #186 の 500 が戻る)。
 *
 * 守ること (理由と実測の記録は docs/runbooks/loading-status.md):
 *   - **死活は画面で見ない**。障害でも 200 になる形と、/login へ 307 になる形が
 *     ある。専用のエンドポイントで見る (#275)
 *   - **`forbidden()` / `unauthorized()` を呼ばない**。`authInterrupts` が未設定で
 *     ただの Error になり、AdminLayout から呼ぶと権限が無いだけの人に障害画面が
 *     出る (#295)
 *   - **AdminLayout で DB を引くなら `resolveOrIncident` で包む** (#188。
 *     `shell-guard.ts`)。AdminLayout は境界の外なので、throw すると 500 になる
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
