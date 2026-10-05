/**
 * 交代・代講を承認したときに教室長へ出す知らせ (#278)。
 *
 * ⚠️ **失効があったときだけ `sticky`** にする。失効は承認の副作用で、承認前の
 * カードには出ていない。4 秒で消すと気づかないまま終わる。
 *
 * ⚠️ 「欠勤の記録」と言わない。失効するのが未承認の申請だけのことがある (#250)。
 * 記録 (`record-substitution-form.tsx`) も同じ文言を使う
 */
export const EXPIRED_ABSENCE_NOTICE =
  "このコマの欠勤申請は失効させました（担当が変わったため）。「記録」タブから確認できます。";

export function approvalNotice(
  applicantName: string,
  expiredAbsences: number,
): { text: string; sticky: boolean } {
  const base = `${applicantName} を代講者として承認しました。`;
  return expiredAbsences > 0
    ? { text: `${base}${EXPIRED_ABSENCE_NOTICE}`, sticky: true }
    : { text: base, sticky: false };
}
