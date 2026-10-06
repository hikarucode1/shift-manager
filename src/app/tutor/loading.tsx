import { StalledLoadingHint } from "@/components/stalled-loading-hint";

/**
 * 講師画面セグメントの読み込み fallback (#186)。
 *
 * ⚠️ 見栄えのためではなく、初回 SSR の 500 回避が本命。実測した挙動と結論は
 * admin/loading.tsx の docstring、トレードオフの詳しい分析は #190 を参照
 * (失敗しても HTTP 200 を返す。障害の種類で見え方が違う)。
 *
 * #185 (#184) では /tutor/notifications だけをページ内 try/catch で救ったが、
 * 残る 6 画面は URL 直アクセスで DB が落ちていれば素の 500 のままだった。
 * この 1 枚でセグメント配下すべての初回ロードが error.tsx に落ちる。
 * 各ページに try/catch を書き写す方式と違い、新規ページを足したときに
 * 書き忘れて穴が開くことがない。
 *
 * ⚠️ layout で DB を引くなら `resolveOrIncident` で包むこと (#188。
 * `shell-guard.ts`)。layout の throw はこの仕組みでは救えず 500 になる
 *
 * 講師ページは「ネイビー hero + カード列」で統一されている (#130/#131) ので
 * スケルトンも同じ形にし、実データ描画時のガタつきを抑える。
 */
export default function TutorLoading() {
  return (
    <div className="space-y-5" role="status">
      <span className="sr-only">読み込み中</span>

      {/* #189: hydration しないクライアントはここまでしか到達しない。
          CSS で 10 秒後に出す (JS は一度も走らない前提) */}
      <StalledLoadingHint contactLabel="教室長" />

      {/* hero (実ページと同じ rounded-xl / bg-primary) */}
      <section className="rounded-xl bg-primary p-4" aria-hidden>
        <div className="h-4 w-28 motion-safe:animate-pulse rounded bg-primary-foreground/20" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="h-[68px] motion-safe:animate-pulse rounded-lg bg-primary-foreground/10" />
          <div className="h-[68px] motion-safe:animate-pulse rounded-lg bg-primary-foreground/10" />
        </div>
      </section>

      <div className="space-y-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 motion-safe:animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
