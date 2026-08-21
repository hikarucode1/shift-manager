import { describe, expect, it } from "vitest";
import {
  INITIAL_POLL_STATE,
  onPollFailure,
  onPollSuccess,
  STALE_AFTER_MS,
  toBadgeState,
} from "@/lib/unread-badge";

const T0 = 1_700_000_000_000;

describe("toBadgeState", () => {
  // ⚠️ この 1 件がこのモジュールの存在理由。旧実装は失敗時に「前回値を維持」と
  // していたが、マウント直後の前回値は useState(0) の 0 なので、開いた瞬間に
  // 失敗するとバッジが消え、**壊れているのに「未読なし」**と同じ絵になった。
  // 2026-07-30 の障害が 9 日間気づかれなかった理由の 1 つ目がこれ。
  it("一度も取得できていない状態で失敗したら、即「不明」にする", () => {
    const state = onPollFailure(INITIAL_POLL_STATE);

    expect(toBadgeState(state, T0)).toEqual({ kind: "unknown" });
  });

  it("取得できたらその件数を出す", () => {
    const state = onPollSuccess(INITIAL_POLL_STATE, 3, T0);

    expect(toBadgeState(state, T0)).toEqual({ kind: "count", count: 3 });
  });

  it("0 件は「不明」ではなく 0 件として出す", () => {
    // 取得できた上での 0 は正常。ここを unknown にすると常に「!」が出る。
    const state = onPollSuccess(INITIAL_POLL_STATE, 0, T0);

    expect(toBadgeState(state, T0)).toEqual({ kind: "count", count: 0 });
  });

  it("失敗しても猶予内なら前回値をそのまま出す", () => {
    // ベルは遷移でアンマウントされず、遷移ごとに即時ポーリングが走る。
    // 回数で数えるとオフラインで下部タブを 2 回叩くだけで数秒で確定してしまう
    // ので、時間で測る。トンネルや画面ロック復帰の数十秒では出さない。
    const state = onPollFailure(onPollSuccess(INITIAL_POLL_STATE, 3, T0));

    expect(toBadgeState(state, T0 + STALE_AFTER_MS - 1)).toEqual({
      kind: "count",
      count: 3,
    });
  });

  it("猶予は 5 分 (障害の検知予算に対して十分速く、トンネルには反応しない)", () => {
    // ⚠️ リテラルで固定する。STALE_AFTER_MS を使ってテストを書くと自己言及に
    // なり、値を変えても緑のまま通る。ここは実質的な SLA。
    expect(STALE_AFTER_MS).toBe(5 * 60 * 1000);
  });

  it("猶予を超えたら、未読ありは淡色で件数を残す", () => {
    // 危険なのは下向きの嘘 (未読があるのに無いと言う) だけ。古い「3」が実は 5
    // だったというズレは開けば解消するので、捨てるより残すほうが情報が多い。
    const state = onPollFailure(onPollSuccess(INITIAL_POLL_STATE, 3, T0));

    expect(toBadgeState(state, T0 + STALE_AFTER_MS)).toEqual({
      kind: "stale",
      count: 3,
    });
  });

  it("猶予を超えたとき、0 件は「不明」にする", () => {
    // ここが本体。0 件のまま古くなると「未読なし」と区別が付かなくなる。
    const state = onPollFailure(onPollSuccess(INITIAL_POLL_STATE, 0, T0));

    expect(toBadgeState(state, T0 + STALE_AFTER_MS)).toEqual({
      kind: "unknown",
    });
  });

  it("復帰したら失敗状態と時刻がリセットされる", () => {
    let state = onPollFailure(onPollSuccess(INITIAL_POLL_STATE, 3, T0));
    state = onPollSuccess(state, 1, T0 + STALE_AFTER_MS * 3);

    expect(toBadgeState(state, T0 + STALE_AFTER_MS * 3)).toEqual({
      kind: "count",
      count: 1,
    });
  });
});
