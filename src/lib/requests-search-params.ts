import type {
  LogPeriodFilter,
  LogStateFilter,
  LogTypeFilter,
} from "@/lib/request-log-query";

export type RequestsTab = "pending" | "log";

export type RequestsView = {
  tab: RequestsTab;
  period: LogPeriodFilter;
  type: LogTypeFilter;
  state: LogStateFilter;
};

/**
 * `/admin/requests` の searchParams を正規化する (#224 / #279)。
 * 知らない値はすべて既定に落とす (URL は手で書き換えられるので throw しない)。
 *
 * ⚠️ `state` に `pending` は無い。未対応は「未対応」タブの担当で、記録タブには
 * 出さない (`LOG_STATES`)
 */
export function parseRequestsSearchParams(sp: {
  tab?: string;
  period?: string;
  type?: string;
  state?: string;
}): RequestsView {
  return {
    tab: sp.tab === "log" ? "log" : "pending",
    period: sp.period === "3m" || sp.period === "all" ? sp.period : "1m",
    type: sp.type === "absence" || sp.type === "swap" ? sp.type : "all",
    state:
      sp.state === "approved" || sp.state === "cancelled" || sp.state === "rejected"
        ? sp.state
        : "all",
  };
}

/**
 * 「記録」タブへのリンク。未対応 ⇄ 記録 を行き来してもフィルタを捨てない。
 *
 * ⚠️ `parseRequestsSearchParams` と**往復できること**をテストで固定している。
 * 片方だけ変えると、タブを行き来したときにフィルタが黙って既定に戻る
 */
export function requestsLogHref(view: Omit<RequestsView, "tab">): string {
  return `/admin/requests?${new URLSearchParams({
    tab: "log",
    period: view.period,
    type: view.type,
    state: view.state,
  }).toString()}`;
}
