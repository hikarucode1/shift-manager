/**
 * 「未対応」タブの欠勤カードで、どの操作を出し、何を知らせるか (#289)。
 *
 * 代講の取り消し・CSV の取り込みなどで担当が変わると (#259 の 5 経路)、元の
 * 担当者の欠勤申請が「未対応」に残る。ここでは「今も担当か」と「コマが
 * 終わったか」で出し分ける。
 *
 * - **今も担当**: これまでどおり承認 / 却下。終わったコマには「承認して
 *   構いません」を添える (#211)
 * - **担当でない・まだ来ていない**: 「不要として閉じる」だけ。承認させない
 *   のは、承認済みの欠勤が (講師, 日付, コマ) の組で残り続け、その講師が
 *   あとで担当に戻ると欠勤マークが付いてしまうため (PR #290 のレビュー)
 * - **担当でない・終わった**: 承認 (実際に休んだ記録として残す) か、不要と
 *   して閉じる。教室長が A の休みを知って CSV で A のコマを差し替えた場面では、
 *   承認するのが正しい
 *
 * ⚠️ **担当でないときは却下を出さない。** 担当でない講師に「却下されました」が
 * 届くと「出勤しろ」と読める。中立に閉じる操作 (`closeUnassignedAbsence`) を使う。
 *
 * サーバ (`decideAbsenceRequest`) も `canApprove` で承認を弾く (カードを開いた
 * まま担当が変わった場合)
 */

/** 「不要として閉じる」で欠勤申請に残す理由 (台帳のコメント欄に出る) */
export const ABSENCE_CLOSED_UNASSIGNED_NOTE = "担当変更のため不要";

const UNASSIGNED =
  "このコマは今は担当ではありません（担当が変わったか、コマが無くなりました）。";

export type PendingAbsenceActions = {
  canApprove: boolean;
  canReject: boolean;
  /** 「不要として閉じる」を出すか */
  canClose: boolean;
  /** 「終了したコマです。…承認して構いません。」を出すか (#211) */
  showEndedHint: boolean;
  /** 担当でないときにカードに出す一文。今も担当なら null */
  notice: string | null;
};

export function pendingAbsenceActions(s: {
  tutorAssigned: boolean;
  isEnded: boolean;
}): PendingAbsenceActions {
  if (s.tutorAssigned) {
    return {
      canApprove: true,
      canReject: true,
      canClose: false,
      showEndedHint: s.isEnded,
      notice: null,
    };
  }
  return s.isEnded
    ? {
        canApprove: true,
        canReject: false,
        canClose: true,
        showEndedHint: false,
        notice: `${UNASSIGNED}実際に休んだ記録として残すなら承認、不要なら「不要として閉じる」を押してください。`,
      }
    : {
        canApprove: false,
        canReject: false,
        canClose: true,
        showEndedHint: false,
        notice: `${UNASSIGNED}この欠勤申請は不要なので「不要として閉じる」を押してください。`,
      };
}
