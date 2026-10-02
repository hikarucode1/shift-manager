import { describe, expect, it } from "vitest";
import {
  parseRequestsSearchParams,
  requestsLogHref,
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

describe("requestsLogHref と parseRequestsSearchParams の往復", () => {
  // ⚠️ 片方だけ変えると、タブを行き来したときにフィルタが黙って既定に戻る
  const periods = ["1m", "3m", "all"] as const;
  const types = ["all", "absence", "swap"] as const;
  const states = ["all", "approved", "cancelled", "rejected"] as const;
  const all = periods.flatMap((period) =>
    types.flatMap((type) => states.map((state) => ({ period, type, state }))),
  );

  it.each(all)("$period / $type / $state が記録タブで戻る", (view) => {
    expect(parseHref(requestsLogHref(view))).toEqual({ tab: "log", ...view });
  });
});
