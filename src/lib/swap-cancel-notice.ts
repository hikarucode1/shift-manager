/**
 * 承認済み代講を取り消したあと、教室長に出す知らせ。
 *
 * - 欠勤の自動失効は戻さないので、登録し直しを促す (#225)
 * - 同じコマに元講師の募集が残っていれば、閉じるか承認するかを促す (#283)。
 *   記録 (#215) は募集を閉じないので、記録を取り消すと担当が戻って募集が
 *   再び承認できる状態になる
 *
 * ⚠️ **講師に知らせたとは書かない。** 講師への訂正は best-effort (失敗しても
 * 取り消しは成功扱い) で、代講者 B には送らない。教室長に伝えるのは、
 * 教室長がすべきこと (承認か却下) だけにする
 */

/** 取り消したコマに元講師の pending 募集が残っているか (#283) */
export type PendingSwapAfterCancel = {
  requesterName: string;
  /** 承認できるか (`isPendingSwapApprovable`) */
  approvable: boolean;
} | null;

export function swapCancelNotice(res: {
  expiredAbsences: number;
  pendingSwap: PendingSwapAfterCancel;
}): string {
  const parts = ["取り消しました。"];
  if (res.expiredAbsences > 0) {
    parts.push(
      "このコマの欠勤申請が交代成立時に自動失効しています。必要なら「代理で欠勤を登録する」から登録し直してください。",
    );
  }
  const p = res.pendingSwap;
  if (p) {
    parts.push(
      p.approvable
        ? `このコマには ${p.requesterName} さんの交代申請が残っていて、担当が戻ったため再び承認できます。「未対応」タブで承認するか、却下（教室長が出した代理募集なら取り下げ）してください。`
        : `このコマには ${p.requesterName} さんの交代申請が残っていますが、過去のコマなので承認できません。「未対応」タブで却下（教室長が出した代理募集なら取り下げ）してください。`,
    );
  }
  return parts.join("");
}
