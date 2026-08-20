import { describe, expect, it } from "vitest";
import {
  INITIAL_POLL_STATE,
  onPollFailure,
  onPollSuccess,
  STALE_AFTER_FAILURES,
  toBadgeState,
} from "@/lib/unread-badge";

describe("toBadgeState", () => {
  // ⚠️ この 1 件がこのモジュールの存在理由。旧実装は失敗時に「前回値を維持」と
  // していたが、マウント直後の前回値は useState(0) の 0 なので、開いた瞬間に
  // 失敗するとバッジが消え、**壊れているのに「未読なし」**と同じ絵になった。
  // 2026-07-30 の障害が 9 日間気づかれなかった理由の 1 つ目がこれ。
  it("一度も取得できていない状態で失敗したら、即「不明」にする", () => {
    const state = onPollFailure(INITIAL_POLL_STATE);

    expect(toBadgeState(state)).toEqual({ kind: "unknown" });
  });

  it("取得できたらその件数を出す", () => {
    const state = onPollSuccess(INITIAL_POLL_STATE, 3);

    expect(toBadgeState(state)).toEqual({ kind: "count", count: 3 });
  });

  it("0 件は「不明」ではなく 0 件として出す", () => {
    // 取得できた上での 0 は正常。ここを unknown にすると常に「!」が出る。
    const state = onPollSuccess(INITIAL_POLL_STATE, 0);

    expect(toBadgeState(state)).toEqual({ kind: "count", count: 0 });
  });

  it("取得できた後の 1 回だけの失敗では前回値を保つ", () => {
    // 回線が不安定な環境 (講師 UI はスマホファースト) で、ポーリングが 1 回
    // こけるたびに表示が揺れるのを避ける。
    const state = onPollFailure(onPollSuccess(INITIAL_POLL_STATE, 3));

    expect(toBadgeState(state)).toEqual({ kind: "count", count: 3 });
  });

  it("連続で失敗したら前回値を捨てて「不明」にする", () => {
    let state = onPollSuccess(INITIAL_POLL_STATE, 3);
    for (let i = 0; i < STALE_AFTER_FAILURES; i += 1) {
      state = onPollFailure(state);
    }

    expect(toBadgeState(state)).toEqual({ kind: "unknown" });
  });

  it("復帰したら失敗回数がリセットされる", () => {
    let state = INITIAL_POLL_STATE;
    for (let i = 0; i < 5; i += 1) state = onPollFailure(state);
    state = onPollSuccess(state, 1);

    expect(toBadgeState(state)).toEqual({ kind: "count", count: 1 });
    expect(toBadgeState(onPollFailure(state))).toEqual({
      kind: "count",
      count: 1,
    });
  });
});
