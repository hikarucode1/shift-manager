import {
  closeAction,
  type PendingSwapApproval,
} from "@/lib/pending-swap-approval";

/**
 * 承認済み代講を取り消したあと、教室長に出す知らせ。
 *
 * - 欠勤の自動失効は戻さないので、登録し直しを促す (#225)
 * - 同じコマに元講師の募集が残っていれば、閉じるか承認するかを促す (#283)。
 *   記録 (#215) は募集を閉じないので、記録を取り消すと担当が戻って募集が
 *   再び承認できる状態になる
 * - 代講者が同じコマに出した募集が残っていれば、閉じるよう促す (#287)。
 *   担当が元講師に戻ったので、その募集は承認できない
 *
 * ⚠️ **講師に知らせたとは書かない。** 講師への通知は best-effort (失敗しても
 * 取り消しは成功扱い)。しかも元講師の募集の「また有効になりました」は、
 * 代講者 B が応募していても B には送らない (B には取り消しの通知が別に届く)。
 * 教室長に伝えるのは、教室長がすべきこと (承認か却下) だけにする。
 *
 * ⚠️ 承認できない理由と閉じ方 (却下 / 取り下げ) は、「未対応」タブと同じ
 * `pendingSwapApproval` の結果から作る。ここで文言を持つと、理由が増えたとき
 * にずれる
 */

/**
 * 取り消したコマに残っている pending 募集 1 件。元講師の募集 (#283) と
 * 代講者の募集 (#287) があり、両方残ることもある
 */
export type PendingSwapAfterCancel = {
  /** 募集を出した講師 */
  requesterName: string;
  isProxy: boolean;
  approval: PendingSwapApproval;
};

export function swapCancelNotice(res: {
  expiredAbsences: number;
  pendingSwaps: PendingSwapAfterCancel[];
}): string {
  const parts = ["取り消しました。"];
  if (res.expiredAbsences > 0) {
    parts.push(
      "このコマの欠勤申請が交代成立時に自動失効しています。必要なら「代理で欠勤を登録する」から登録し直してください。",
    );
  }
  for (const p of res.pendingSwaps) {
    parts.push(
      p.approval.approvable
        ? `このコマには ${p.requesterName} さんの交代申請が残っていて、担当が戻ったため再び承認できます。「未対応」タブで承認するか、${closeAction(p.isProxy)}`
        : `このコマには ${p.requesterName} さんの交代申請が「未対応」タブに残っています。${p.approval.notice ?? ""}`,
    );
  }
  return parts.join("");
}

/**
 * 代講を取り消したとき、代講者 B への通知に足す一文と行き先 (#287 / #288)。
 *
 * - B の名前で募集が出ていなければ、何も足さず従来どおり `/tutor/open-swaps`
 *   (#245 の「応募した募集の結果」。/tutor は担当が戻った直後で出ない)
 * - 出ていれば「承認できません」を足す。「このコマの募集」と書くと、B が
 *   元講師の募集に応募している場合にその応募まで無効と読めるので、「あなたの
 *   名前で出ている」と限定する。教室長の代理募集 (#231) もあるので「あなたが
 *   出した」とは書かない
 * - 行き先は、B が自分で取り下げられる募集なら `/tutor/swaps`。代理募集は
 *   B には取り下げられない (`cancelSwapRequest` が createdBy で弾く) ので
 *   従来どおり `/tutor/open-swaps`
 */
export function substituteCancelNotice(
  substituteSwap: { isProxy: boolean } | null,
): { bodySuffix: string; href: "/tutor/swaps" | "/tutor/open-swaps" } {
  if (!substituteSwap) return { bodySuffix: "", href: "/tutor/open-swaps" };
  return {
    bodySuffix:
      " ／ このコマの担当ではなくなったため、あなたの名前で出ている交代・代講の募集は承認できません。",
    href: substituteSwap.isProxy ? "/tutor/open-swaps" : "/tutor/swaps",
  };
}
