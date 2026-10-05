/**
 * `/admin/requests` のタブとフィルタ (#224 / #279)。
 *
 * ⚠️ **候補値はここが唯一の定義。** `request-log-query.ts` は `server-only` で
 * クライアントから値を import できないので、こちらに置いてあちらが import する。
 * 候補を足すと、正規化 (`parseRequestsSearchParams`) は自動で追従し、
 * 画面のラベル (`*_LABELS`) と期間の月数 (`LOG_PERIOD_MONTHS`) は**足し忘れると
 * 型エラーになる** (`Record` で全候補を要求している)。状態の SQL は
 * `LOG_STATES` をそのまま使う
 */

export const LOG_PERIODS = ["1m", "3m", "all"] as const;
export const LOG_TYPES = ["all", "absence", "swap"] as const;
/** 台帳に出す状態。`pending` は未対応タブの担当なので含めない */
export const LOG_STATES = ["approved", "cancelled", "rejected"] as const;

/** 既定は直近 1 ヶ月。飽和 (#224) は件数上限ではなく期間で抑える */
export type LogPeriodFilter = (typeof LOG_PERIODS)[number];
export type LogTypeFilter = (typeof LOG_TYPES)[number];
export type LogStateFilter = (typeof LOG_STATES)[number] | "all";

/** 期間の月数。`all` は下限なし */
export const LOG_PERIOD_MONTHS: Record<Exclude<LogPeriodFilter, "all">, number> =
  { "1m": 1, "3m": 3 };

export const LOG_PERIOD_LABELS: Record<LogPeriodFilter, string> = {
  "1m": "直近1ヶ月",
  "3m": "直近3ヶ月",
  all: "すべて",
};
export const LOG_TYPE_LABELS: Record<LogTypeFilter, string> = {
  all: "すべて",
  absence: "欠勤",
  swap: "交代・代講",
};
export const LOG_STATE_LABELS: Record<LogStateFilter, string> = {
  all: "すべて",
  approved: "承認済み",
  cancelled: "取り消し済み",
  rejected: "却下",
};

const DEFAULT_FILTERS = { period: "1m", type: "all", state: "all" } as const;

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
    period: oneOf(LOG_PERIODS, sp.period, DEFAULT_FILTERS.period),
    type: oneOf(LOG_TYPES, sp.type, DEFAULT_FILTERS.type),
    state: oneOf(LOG_STATES, sp.state, DEFAULT_FILTERS.state as LogStateFilter),
  };
}

/**
 * タブのリンク。**未対応 ⇄ 記録 を行き来してもフィルタを捨てない** ので、
 * 未対応タブのリンクにもフィルタを載せる (未対応タブ自体は使わない)。
 * 既定値と同じものは載せない (何も変えていなければ素の `/admin/requests`)。
 *
 * ⚠️ `parseRequestsSearchParams` と**往復できること**をテストで固定している。
 * 片方だけ変えると、タブを行き来したときにフィルタが黙って既定に戻る
 */
export function requestsHref(view: RequestsView): string {
  const sp = new URLSearchParams();
  if (view.tab !== "pending") sp.set("tab", view.tab);
  for (const key of ["period", "type", "state"] as const) {
    if (view[key] !== DEFAULT_FILTERS[key]) sp.set(key, view[key]);
  }
  const q = sp.toString();
  return q ? `/admin/requests?${q}` : "/admin/requests";
}
