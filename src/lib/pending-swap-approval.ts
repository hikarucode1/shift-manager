/**
 * 教室長の「未対応」タブで、その募集を承認できるか・見出しに何と出すか (#262)。
 *
 * ⚠️ **一覧から外さない。** 承認できない募集こそ教室長が却下 (代理募集なら
 * 取り下げ) で閉じる必要がある。#259 で講師側の一覧からは外したが、こちらは
 * 逆で、**出したうえで承認だけ塞ぐ**。
 *
 * ⚠️ **判定の順序は `decideSwapRequest` と揃える。** あちらは過去日チェックを
 * 付け替えより先に行うので、両方該当するときサーバーが返す理由は「過去のコマ」。
 * UI が別の理由を出すと、教室長が直したつもりで直っていないことになる。
 *
 * ⚠️ **「通知済み」と書かない。** #253 の通知が飛ぶのは `recordSubstitution`
 * 経由のときだけで、別の交代の承認や CSV 再取り込みで担当が変わった場合は
 * 誰にも飛んでいない。担当が変わる経路は 5 つある (#259 で洗い出した)。
 */

export type PendingSwapApprovalState = {
  /** 過去日で、承認がサーバー側で弾かれるか (#165) */
  isPastDate: boolean;
  /**
   * 申請者が今もそのコマの担当か (#262)。
   *
   * 条件は `decideSwapRequest` が付け替えに使う WHERE と同じ
   * (`weekly_shifts` に (申請者, 日, コマ) の行があるか)。false なら承認は
   * 必ず「付け替え対象の確定シフトが見つかりません」で落ちる。
   */
  requesterAssigned: boolean;
  /** コマが既に終了しているか (#178)。注意表示のみで、同日中の承認は通る */
  isEnded: boolean;
  /** 教室長が代理で出した募集か (#231)。閉じ方が「却下」ではなく「取り下げ」 */
  isProxy: boolean;
};

export type PendingSwapApproval = {
  /** 応募者の承認ボタンを押せるか */
  approvable: boolean;
  /** 応募者リストの上に出す一文 */
  heading: string;
};

/** 承認できないときに案内する閉じ方 (#231: 代理募集は「却下」ではない) */
function closeHint(isProxy: boolean): string {
  return isProxy ? "取り下げは可能です" : "却下は可能です";
}

export function pendingSwapApproval(
  s: PendingSwapApprovalState,
): PendingSwapApproval {
  if (s.isPastDate) {
    return {
      approvable: false,
      heading: `過去のコマのため承認できません (${closeHint(s.isProxy)}):`,
    };
  }
  if (!s.requesterAssigned) {
    return {
      approvable: false,
      heading: `このコマは担当が変わったため承認できません (${closeHint(s.isProxy)}):`,
    };
  }
  if (s.isEnded) {
    return {
      approvable: true,
      heading: "終了したコマです。実際に代講が入った場合のみ承認してください:",
    };
  }
  return { approvable: true, heading: "応募者から代講者を選んで承認:" };
}
