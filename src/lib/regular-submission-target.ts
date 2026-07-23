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
 * Issue #165 (H3): saveFixedShifts の delete / ロック範囲を決める。
 *
 * 以前は「effectiveFrom 以降すべて」を削除していたが、締切チェック
 * (fetchPeriodWindow) は effectiveFrom 1 点の期しか検証しないため、受付中の期が
 * 無いとき (resolveServerEffectiveFrom がクライアント日付を素通し) に過去の未来
 * 日付を送ると、締切超過済み / 未開放の別期の draft 行まで巻き添え削除できた。
 *
 * effectiveFrom が「データキー」と「認可スコープ」を兼ねていたのが原因。ここで
 * 認可済みの範囲だけに削除を限定する:
 * - 受付中の期がある: effectiveFrom は期初に強制されるので、その期の日付範囲
 *   [startDate, endDate] のみ (= その期の提出を置換。期外は触らない)。
 * - 受付中の期が無い (アドホック): effectiveFrom 単一日のみ (前方一括削除しない)。
 */
export type SaveScope =
  | { kind: "period"; from: string; to: string }
  | { kind: "exact"; date: string };

export function resolveSaveScope(params: {
  activePeriod: { startDate: string; endDate: string } | null;
  effectiveFrom: string;
}): SaveScope {
  const { activePeriod, effectiveFrom } = params;
  if (activePeriod) {
    return { kind: "period", from: activePeriod.startDate, to: activePeriod.endDate };
  }
  return { kind: "exact", date: effectiveFrom };
}

/**
 * Issue #161: 新しい期の初回表示で「前期パターン」を引き継ぐ元の提出を選ぶ。
 *
 * 元は fixed_shifts 行の max(effective_from) で「前期」を近似していたが、
 * それだと (a) 全コマ不可 (メタのみ・fixed_shifts 行なし) の直近提出を飛ばして
 * さらに古い期を拾う、(b) 期に紐づかないアドホックな fixed_shifts 行を前期と
 * 誤認する、という問題があった。提出単位 (fixed_shift_submissions) で選ぶことで
 * 「本人が最後に提出した内容」を正しく起点にする。
 */
export type PrefillSourceCandidate = {
  effectiveFrom: string;
  effectiveTo: string | null;
  desiredDays: number | null;
  desiredSlots: number | null;
};

export function selectPrefillSourceSubmission(params: {
  candidates: PrefillSourceCandidate[];
  targetEffectiveFrom: string;
}): PrefillSourceCandidate | null {
  const { candidates, targetEffectiveFrom } = params;
  const prior = candidates
    .filter((c) => c.effectiveFrom < targetEffectiveFrom)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const source = prior[0] ?? null;
  if (!source) return null;
  // 本人が適用終了日を新期開始より前に設定していた = そのパターンを明示的に
  // 終了させた意思。引き継がない (空フォーム = #161 前の挙動に戻す)。
  if (source.effectiveTo && source.effectiveTo < targetEffectiveFrom) {
    return null;
  }
  return source;
}

/**
 * Issue #161: 当期に既にデータがあるか (プリフィル可否)。
 * currentEntries は availability="no" を除外するため、全コマ不可で提出済みの
 * 当期行を「未提出」と誤判定してプリフィルで上書きしないよう、提出行の有無と
 * 生の fixed_shifts 行の有無で判断する。
 */
export function hasCurrentPeriodData(params: {
  hasSubmissionRow: boolean;
  hasAnyRawFixedShiftRow: boolean;
}): boolean {
  return params.hasSubmissionRow || params.hasAnyRawFixedShiftRow;
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
