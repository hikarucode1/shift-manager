/**
 * 通知ベルのバッジ状態 (#207)。
 *
 * 2026-07-30 の障害が 9 日間気づかれなかった理由の 1 つ目が
 * 「ベルが取得失敗を握り潰し、**壊れていてもバッジが 0 のまま**で正常時と
 * 区別が付かない」だった。**「取得できなかった」を「未読 0」と混ぜないこと**が
 * このモジュールの目的で、未読数を出すこと自体ではない (#205 と同じ方針)。
 */
export type BadgeState =
  | { kind: "count"; count: number }
  /** 取得できていない。「未読なし」と言い切ってはいけない状態 */
  | { kind: "unknown" };

export type PollState = {
  /** 直近で取得できた未読数。一度も取得できていなければ null */
  lastCount: number | null;
  /** 取得できた後に連続で失敗した回数 */
  consecutiveFailures: number;
};

export const INITIAL_POLL_STATE: PollState = {
  lastCount: null,
  consecutiveFailures: 0,
};

/**
 * 一度でも取得できた後は、この回数だけ連続で失敗するまで前回値を保つ。
 * 回線が不安定な環境 (講師 UI はスマホファースト) で 1 回の失敗ごとに
 * 表示が揺れるのを避けるため。
 */
export const STALE_AFTER_FAILURES = 2;

export function onPollSuccess(_state: PollState, count: number): PollState {
  return { lastCount: count, consecutiveFailures: 0 };
}

export function onPollFailure(state: PollState): PollState {
  return { ...state, consecutiveFailures: state.consecutiveFailures + 1 };
}

/**
 * 表示に落とす。
 *
 * ⚠️ **一度も取得できていない状態 (`lastCount === null`) で失敗したら、即「不明」**。
 * ここを「前回値を維持」で書くと初期値の 0 がそのまま出て、**まさに直したい
 * 「壊れているのに未読なし」に戻る**。旧実装がこの形だった。
 */
export function toBadgeState(state: PollState): BadgeState {
  if (state.lastCount === null) {
    return state.consecutiveFailures > 0
      ? { kind: "unknown" }
      : { kind: "count", count: 0 };
  }

  return state.consecutiveFailures >= STALE_AFTER_FAILURES
    ? { kind: "unknown" }
    : { kind: "count", count: state.lastCount };
}
