/**
 * server action の **reject** を `{ ok: false }` に畳む (#202)。
 *
 * パネルはどこも `{ ok: false, error }` を**返す**分岐を持っているが、action が
 * reject する経路は捕まえていなかった。
 *
 * 捕まえないと、React 19 の Action (`startTransition` に渡した async 関数) の
 * 例外として**最寄りのエラー境界まで飛ぶ**。`tutor` / `admin` には
 * `error.tsx` があるので (#185 / #187)、**ページ全体が「画面を表示できません
 * でした。」に差し替わる** (dev で実測)。
 *
 * つまり失敗の伝わり方が壊れているというより、**粒度が壊れている**:
 * 「この操作が失敗した」で済む話が「画面が死んだ」になり、
 * **入力途中の内容 (選択したコマ・書きかけの理由) ごと消える**。再試行は
 * フォームの最初からになる。`{ ok: false }` に畳めば、既存の失敗分岐が
 * その場にメッセージを出し、入力はそのまま残る。
 *
 * reject は実在する:
 * - server action 内の try/catch の**外**にある DB 呼び出し
 * - **認証 API に到達できないとき** (#193 で `requireSession` は到達不能を
 *   redirect ではなく throw に変えた)。障害中にアプリ全体のボタンが
 *   静かに無反応になるのを、ここで止める
 * - 壊れた認証 cookie (#197 の系列)
 *
 * ⚠️ **文言で原因を断定しないこと** (#184 の方針、`system-unavailable.tsx` の
 * docstring 参照)。実際の障害はサーバー側のことが多く、「通信状況を確認して
 * ください」と書くと誤った自己解決を促し、**障害が報告されないまま埋もれる**。
 *
 * ⚠️ 操作の種類 (保存 / 承認 / 申請 / 取消) を問わず使うので、文言は動詞を
 * 固定しないこと。
 */
export type IndeterminateFailure = {
  ok: false;
  error: string;
  /**
   * **サーバーが書いたかどうか分からない**ことの印 (#202 レビュー指摘)。
   *
   * action が `{ ok: false }` を**返した**ときは「確実に書いていない」なので、
   * 各パネルは画面をそのままにしてよい (だから成功時しか `router.refresh()`
   * しない作りになっている)。**reject は違う**: タイムアウトや接続断では
   * サーバーが commit したのにレスポンスだけ落ちた可能性がある。
   *
   * 見分けが付かないまま画面を書き換えると、楽観的更新のロールバックが
   * **能動的に嘘をつく** (DB は保存済みなのに画面は元に戻る)。この印を見て
   * 呼び出し側は `router.refresh()` し、サーバーの真実を取りに行くこと。
   */
  indeterminate: true;
};

/** `toFailedResult` 由来か (= サーバーの結果が不明) */
export function isIndeterminate(res: object): boolean {
  return "indeterminate" in res;
}

export function toFailedResult(e: unknown): IndeterminateFailure {
  // 画面には出せない診断情報をブラウザのコンソールに残す。
  console.error("server action failed:", e);

  // production では server action の例外はメッセージがサニタイズされる代わりに
  // digest を持つ。error.tsx が「エラーID」として出していたのと同じ値なので、
  // 報告の導線をトースト粒度で引き継ぐ。
  const digest = (e as { digest?: unknown } | null)?.digest;
  const suffix = typeof digest === "string" ? `（エラーID: ${digest}）` : "";

  return {
    ok: false,
    error: `処理を完了できませんでした。時間をおいて再度お試しください。${suffix}`,
    indeterminate: true,
  };
}
