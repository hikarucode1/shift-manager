import { describe, expect, it } from "vitest";
import {
  LOG_PERIODS,
  LOG_STATES,
  LOG_TYPES,
  parseRequestsSearchParams,
  requestsHref,
} from "@/lib/requests-search-params";

/** href の query を page が受け取る形に戻す */
function parseHref(href: string) {
  const url = new URL(href, "http://localhost");
  return parseRequestsSearchParams(Object.fromEntries(url.searchParams));
}

describe("parseRequestsSearchParams", () => {
  it("何も無ければ未対応タブ・直近 1 ヶ月・すべて", () => {
    expect(parseRequestsSearchParams({})).toEqual({
      tab: "pending",
      period: "1m",
      type: "all",
      state: "all",
    });
  });

  it("知らない値は既定に落とす (URL は手で書き換えられる)", () => {
    expect(
      parseRequestsSearchParams({ period: "6m", type: "x", state: "bogus" }),
    ).toMatchObject({ period: "1m", type: "all", state: "all" });
  });

  it("state に pending は無い (未対応は記録タブに出さない)", () => {
    expect(parseRequestsSearchParams({ state: "pending" }).state).toBe("all");
  });
});

describe("requestsHref と parseRequestsSearchParams の往復", () => {
  // ⚠️ 片方だけ変えると、タブを行き来したときにフィルタが黙って既定に戻る。
  // 未対応タブのリンクも含める (#282 レビュー: 以前は素の /admin/requests で
  // 記録 → 未対応 → 記録 でフィルタが消えていた)
  const all = (["pending", "log"] as const).flatMap((tab) =>
    LOG_PERIODS.flatMap((period) =>
      LOG_TYPES.flatMap((type) =>
        [...LOG_STATES, "all" as const].map((state) => ({
          tab,
          period,
          type,
          state,
        })),
      ),
    ),
  );

  it.each(all)("$tab / $period / $type / $state が戻る", (view) => {
    expect(parseHref(requestsHref(view))).toEqual(view);
  });
});
