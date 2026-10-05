/**
 * 「未対応」タブの欠勤申請を承認できるか (#289)。
 *
 * ⚠️ **担当でなくなったコマの欠勤は承認させない。** 代講の取り消し・CSV の
 * 取り込みなどで担当が変わると (#259 の 5 経路)、元の担当者の欠勤申請が
 * 残る。承認しても週次表には何も出ず (欠勤マークは講師・日付・コマの組で付く)、
 * 講師に意味のない「承認されました」が届くだけ。教室長には却下を促す。
 *
 * ⚠️ **終了したコマは塞がない** (#211)。後から欠勤を登録するのは正当な実務。
 * 担当かどうかの確認は、それとは別に効く。
 *
 * サーバ (`decideAbsenceRequest`) も同じ文言で拒否する。カードを開いたまま
 * 担当が変わった場合はサーバで止まる
 */
export const ABSENCE_UNASSIGNED_NOTICE =
  "このコマは担当が変わったため承認できません。却下してください。";

export function pendingAbsenceApproval(s: { tutorAssigned: boolean }): {
  approvable: boolean;
  /** 承認できないときにカードに出す一文。承認できるときは null */
  notice: string | null;
} {
  return s.tutorAssigned
    ? { approvable: true, notice: null }
    : { approvable: false, notice: ABSENCE_UNASSIGNED_NOTICE };
}
