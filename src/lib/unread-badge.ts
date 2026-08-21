/**
 * 通知ベルのバッジ状態 (#207)。
 *
 * 2026-07-30 の障害が 9 日間気づかれなかった理由の 1 つ目が
 * 「ベルが取得失敗を握り潰し、**壊れていてもバッジが 0 のまま**で正常時と
 * 区別が付かない」だった。**「取得できなかった」を「未読 0」と混ぜないこと**が
 * このモジュールの目的で、未読数を出すこと自体ではない (#205 と同じ方針)。
 *
 * ⚠️ **危険なのは下向きの嘘だけ**、という非対称性で設計している (レビュー指摘):
 * - 「未読があるのに無いと言う」= #207 の害そのもの。絶対に避ける
 * - 「前回の 3 件が古く、実は 5 件」= 開けば解消する軽微なズレ
 *
 * したがって取得できないとき、**前回値が 1 件以上なら件数を淡色で残し**
 * (`stale`)、**0 件または未取得のときだけ「不明」**にする。一律に件数を捨てる
 * より情報が多く、かつ危険な方向には倒れない。
 */
export type BadgeState =
  /** 取得できた件数 */
  | { kind: "count"; count: number }
  /** 前回値は残っているが最新か分からない (件数 >= 1) */
  | { kind: "stale"; count: number }
  /** 未読の有無すら分からない。「未読なし」と言い切ってはいけない状態 */
  | { kind: "unknown" };

export type PollState = {
  /** 直近で取得できた未読数。一度も取得できていなければ null */
  lastCount: number | null;
  /** 直近で取得できた時刻 (epoch ms)。一度も取得できていなければ null */
  lastSuccessAt: number | null;
  /** 取得に失敗している状態か */
  failing: boolean;
};

export const INITIAL_POLL_STATE: PollState = {
  lastCount: null,
  lastSuccessAt: null,
  failing: false,
};

/**
 * 取得できない状態がこの時間続いたら、前回値を「当てにならない」と見なす。
 *
 * ⚠️ **回数ではなく時間で測る**。以前は「連続 2 回失敗」だったが、ベルは
 * tutor layout にあってクライアント遷移でアンマウントされず、**遷移のたびに
 * 即時ポーリングが走る**ので、オフラインで下部タブを 2 回叩くだけで数秒で
 * 確定してしまった (レビュー指摘)。
 *
 * 検知の予算から逆算しても回数ベースは過敏すぎる: 防ぎたい障害は **9 日間**
 * 気づかれなかったもので、5 分の検知遅れは目的を何も損なわない。一方
 * トンネルや画面ロック復帰の数十秒は、これで誤発火しなくなる。
 */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export function onPollSuccess(
  _state: PollState,
  count: number,
  now: number,
): PollState {
  return { lastCount: count, lastSuccessAt: now, failing: false };
}

export function onPollFailure(state: PollState): PollState {
  return { ...state, failing: true };
}

/**
 * 表示に落とす。
 *
 * ⚠️ **一度も取得できていない状態 (`lastSuccessAt === null`) で失敗したら、即「不明」**。
 * ここを「前回値を維持」で書くと初期値の 0 がそのまま出て、**まさに直したい
 * 「壊れているのに未読なし」に戻る**。旧実装がこの形だった。
 */
export function toBadgeState(state: PollState, now: number): BadgeState {
  if (!state.failing && state.lastCount !== null) {
    return { kind: "count", count: state.lastCount };
  }

  // まだ一度も取れていない。失敗していれば「不明」、初回の応答待ちなら 0 件の絵
  if (state.lastSuccessAt === null || state.lastCount === null) {
    return state.failing ? { kind: "unknown" } : { kind: "count", count: 0 };
  }

  // 失敗中。猶予内なら前回値をそのまま見せる
  if (now - state.lastSuccessAt < STALE_AFTER_MS) {
    return { kind: "count", count: state.lastCount };
  }

  // 猶予切れ。1 件以上なら淡色で残し、0 件なら「不明」
  return state.lastCount > 0
    ? { kind: "stale", count: state.lastCount }
    : { kind: "unknown" };
}
