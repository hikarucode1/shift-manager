import { describe, expect, it } from "vitest";
import { toHealthView } from "@/lib/notification-health";

describe("toHealthView", () => {
  // ⚠️ このモジュールの本体は「取得できない」を「0 件」と混ぜないこと。
  // 2026-07-30 の障害が 9 日間気づかれなかったのは、ベルが失敗を握り潰して
  // バッジが 0 のままだったから。ここで同じ形を作ると機能自体が無意味になる。
  it("取得できなかったときに 0 と表示しない", () => {
    const view = toHealthView(null);

    expect(view.state).toBe("unavailable");
    expect(view.value).not.toBe("0");
  });

  it("取得できなかったときはエラーID を添える (問い合わせの手がかり)", () => {
    expect(toHealthView(null, "ab12cd34").caption).toContain("ab12cd34");
  });

  it("配信があれば件数と最終日時を出す", () => {
    const view = toHealthView({
      recentCount: 12,
      latestAt: new Date("2026-08-20T05:30:00Z"), // JST 14:30
    });

    expect(view.state).toBe("ok");
    expect(view.value).toBe("12");
    expect(view.caption).toContain("14:30");
  });

  it("最終日時は JST で出す (サーバーの TZ に依存しない)", () => {
    // アプリは OS の TZ に依存しない方針 (README)。UTC で動く本番でも
    // 教室長が見るのは日本時間。
    const view = toHealthView({
      recentCount: 1,
      latestAt: new Date("2026-08-19T15:00:00Z"), // JST 8/20 00:00
    });

    expect(view.caption).toContain("8/20");
  });

  it("0 件は『壊れている』ではなく『動きが無い』として区別する", () => {
    // 誰も通知の出る操作をしていないだけの状態。取得不可と混ぜない。
    const view = toHealthView({ recentCount: 0, latestAt: null });

    expect(view.state).toBe("idle");
    expect(view.value).toBe("0");
    expect(view.caption).toBe("最終 —");
  });

  it("直近 0 件でも過去に配信があれば最終日時を残す", () => {
    // 「いつから止まっているか」が分かることが検知の手がかりになる。
    const view = toHealthView({
      recentCount: 0,
      latestAt: new Date("2026-07-30T01:00:00Z"),
    });

    expect(view.state).toBe("idle");
    expect(view.caption).toContain("7/30");
  });
});
