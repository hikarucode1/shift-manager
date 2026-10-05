/**
 * 承認済み代講を取り消したあと、教室長に出す知らせ。
 *
 * - 欠勤の自動失効は戻さないので、登録し直しを促す (#225)
 * - 同じコマに元講師の募集が残っていれば、閉じるか承認するかを促す (#283)。
 *   記録 (#215) は募集を閉じないので、記録を取り消すと担当が戻って募集が
 *   再び承認できる状態になる
 *
 * ⚠️ 「応募者に通知済み」と言い切らない。通知は best-effort で、募集が
 * pending の間は新しい応募も入る (`record-substitution-form.tsx` と同じ判断)
 */
export function swapCancelNotice(res: {
  expiredAbsences: number;
  pendingSwap: { requesterName: string; approvable: boolean } | null;
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
        ? `このコマには ${p.requesterName} さんの交代申請が残っていて、担当が戻ったため再び承認できます。「未対応」タブで承認するか、却下（教室長が出した代理募集なら取り下げ）してください。申請者と現時点の応募者には、また承認できる状態に戻ったことを通知しました。`
        : `このコマには ${p.requesterName} さんの交代申請が残っていますが、過去のコマなので承認できません。「未対応」タブで却下（教室長が出した代理募集なら取り下げ）してください。`,
    );
  }
  return parts.join("");
}
