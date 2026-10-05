/**
 * `/admin/requests` のタブとフィルタ (#224 / #279)。
 *
 * ⚠️ **候補値はここが唯一の定義。** `request-log-query.ts` は `server-only` で
 * クライアントから値を import できないので、こちらに置いてあちらが import する。
 * 候補を足すときはここだけ変えれば、正規化・SQL・選択肢がそろって追従する
 */

export const LOG_PERIODS = ["1m", "3m", "all"] as const;
export const LOG_TYPES = ["all", "absence", "swap"] as const;
/** 台帳に出す状態。`pending` は未対応タブの担当なので含めない */
export const LOG_STATES = ["approved", "cancelled", "rejected"] as const;

/** 既定は直近 1 ヶ月。飽和 (#224) は件数上限ではなく期間で抑える */
export type LogPeriodFilter = (typeof LOG_PERIODS)[number];
export type LogTypeFilter = (typeof LOG_TYPES)[number];
export type LogStateFilter = (typeof LOG_STATES)[number] | "all";

export type RequestsTab = "pending" | "log";

export type RequestsFilters = {
  period: LogPeriodFilter;
  type: LogTypeFilter;
  state: LogStateFilter;
};

export type RequestsView = RequestsFilters & { tab: RequestsTab };

function oneOf<T extends string>(
  candidates: readonly T[],
  value: string | undefined,
  fallback: T,
): T {
  return (candidates as readonly string[]).includes(value ?? "")
    ? (value as T)
    : fallback;
}

/**
 * searchParams を正規化する。知らない値はすべて既定に落とす
 * (URL は手で書き換えられるので throw しない)
 */
export function parseRequestsSearchParams(sp: {
  tab?: string;
  period?: string;
  type?: string;
  state?: string;
}): RequestsView {
  return {
    tab: sp.tab === "log" ? "log" : "pending",
    period: oneOf(LOG_PERIODS, sp.period, "1m"),
    type: oneOf(LOG_TYPES, sp.type, "all"),
    state: oneOf(LOG_STATES, sp.state, "all" as LogStateFilter),
  };
}

/**
 * タブのリンク。**未対応 ⇄ 記録 を行き来してもフィルタを捨てない** ので、
 * 未対応タブのリンクにもフィルタを載せる (未対応タブ自体は使わない)。
 *
 * ⚠️ `parseRequestsSearchParams` と**往復できること**をテストで固定している。
 * 片方だけ変えると、タブを行き来したときにフィルタが黙って既定に戻る
 */
export function requestsHref(view: RequestsView): string {
  return `/admin/requests?${new URLSearchParams({
    tab: view.tab,
    period: view.period,
    type: view.type,
    state: view.state,
  }).toString()}`;
}
