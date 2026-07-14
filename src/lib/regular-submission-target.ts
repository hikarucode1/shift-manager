/**
 * Issue #156: 講師のレギュラー（固定シフト）希望提出の「対象起点 (effective_from)」を
 * 決める pure 関数群。
 *
 * 提出データは effective_from をキーに保存され、どの期 (regular_shift_periods) に
 * 属するかは effective_from から逆引きされる。従来はこの起点の既定値が
 * `latestEffectiveFrom ?? activePeriod.startDate ?? today` の順で、過去に today
 * ベースで作られた古い提出日 (latestEffectiveFrom) が受付中の期より優先され、
 * 「7月に10月分を提出したのに7月に反映される」ズレが起きていた (#156)。
 *
 * ここでは「受付中の期があれば必ずその期の開始日を起点にする」を pure 関数として
 * 固定し、既定値・既存提出の復元キー・保存キーすべてで同じ起点を使わせる。
 */

/**
 * 提出対象の起点 (effective_from, "YYYY-MM-DD") を決める。
 *
 * - 受付中の期がある: 必ずその期の開始日 (activePeriodStartDate)。
 *   → 講師は「いま受付中の期」に対して提出しているので、起点は期の開始日で固定。
 * - 受付中の期が無い: 既存提出の最新 effective_from → today の順でフォールバック。
 *   → アドホック提出や、過去分の閲覧のための後方互換。
 */
export function resolveSubmissionEffectiveFrom(params: {
  activePeriodStartDate: string | null;
  latestEffectiveFrom: string | null;
  today: string;
}): string {
  const { activePeriodStartDate, latestEffectiveFrom, today } = params;
  if (activePeriodStartDate) return activePeriodStartDate;
  return latestEffectiveFrom ?? today;
}

/**
 * Issue #156 (#160 review): 保存時 (saveFixedShifts) の起点をサーバ側で決める。
 *
 * 受付中の期があれば、その開始日を**サーバ権威で強制**する (クライアントの
 * effectiveFrom は disabled 属性のみでは改竄可能なので信頼しない)。受付中の期が
 * 無い場合のみ、クライアント指定の effectiveFrom を使う (アドホック提出)。
 *
 * resolveSubmissionEffectiveFrom (表示・復元用) と対になるが、こちらは
 * latestEffectiveFrom フォールバックを持たない: 保存はその瞬間に受付中の期に
 * 帰属させるか、明示指定のアドホックか、の二択で十分なため。
 */
export function resolveServerEffectiveFrom(params: {
  activePeriodStartDate: string | null;
  clientEffectiveFrom: string;
}): string {
  const { activePeriodStartDate, clientEffectiveFrom } = params;
  return activePeriodStartDate ?? clientEffectiveFrom;
}

/**
 * 既存提出/シフトを復元するためのクエリ下限日 (inclusive)。
 *
 * 通常は today だが、受付中の期の開始日が過去日 (= 期の開始後に遅れて提出/修正する
 * ケース) の場合、`effective_from >= today` の絞り込みだけだと期初 (< today) で
 * 保存された自分の希望を取りこぼす。そのため期初が過去日なら下限を期初まで広げる。
 */
export function submissionQueryLowerBound(params: {
  activePeriodStartDate: string | null;
  today: string;
}): string {
  const { activePeriodStartDate, today } = params;
  if (activePeriodStartDate && activePeriodStartDate < today) {
    return activePeriodStartDate;
  }
  return today;
}
