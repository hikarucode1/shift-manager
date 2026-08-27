/**
 * 「自分が応募した代講募集」がどうなったか (#245)。
 *
 * 応募者から見た結果は 4 通りあり、`status` だけでは足りない (approved でも
 * **自分が選ばれたかどうか**で意味が正反対になる)。画面で
 * `status === "approved" ? … : …` と書くと、今日 admin 側で 3 回起きた
 * 「行の種類が増えるたびに嘘が出る」を講師側でも繰り返すので、ここに集約する。
 */
export type ApplicationOutcome =
  /** 自分が代講者に決まった */
  | "chosen"
  /** 承認されたが、代講者は別の講師だった */
  | "not-chosen"
  /** 教室長が募集を却下した */
  | "rejected"
  /** 承認される前に募集が取り下げられた (申請者本人 / 教室長のどちらも) */
  | "withdrawn"
  /**
   * 一度承認されたあとで教室長が取り消した (#213)。`withdrawn` と分ける —
   * 落選者から見ると「募集が取り下げられた」のではなく「決まった代講が
   * 後から取り消された」で、意味が違う
   */
  | "cancelled-after-approval";

export const OUTCOME_LABEL: Record<ApplicationOutcome, string> = {
  chosen: "あなたに決まりました",
  "not-chosen": "他の講師に決まりました",
  rejected: "却下されました",
  withdrawn: "取り下げられました",
  "cancelled-after-approval": "決まった代講が取り消されました",
};

/**
 * ⚠️ `pending` は渡さないこと。応募中の募集は `/tutor/open-swaps` の一覧に
 * 「応募済み」として出ており、結果一覧の対象ではない。
 */
export function applicationOutcome(
  status: "approved" | "rejected" | "cancelled",
  chosen: boolean,
  /** `approved_applicant_id` が入っているか (= 一度は承認された) */
  wasApproved: boolean,
): ApplicationOutcome {
  if (status === "rejected") return "rejected";
  if (status === "cancelled") {
    return wasApproved ? "cancelled-after-approval" : "withdrawn";
  }
  return chosen ? "chosen" : "not-chosen";
}

/**
 * 決定時のコメント (`decision_note`) をこの応募者に見せてよいか。
 *
 * ⚠️ **承認後の取り消し理由は「決まった代講者」についての説明**で、落選した
 * 応募者宛ではない (例: 「B が体調不良で来られなくなったため」)。募集全体に
 * ついての却下理由・取り下げ理由と違い、他人の事情が混ざる。
 * 選ばれた本人には見せる (自分の代講が取り消された理由なので)。
 */
export function canSeeDecisionNote(
  outcome: ApplicationOutcome,
  chosen: boolean,
): boolean {
  if (outcome === "cancelled-after-approval") return chosen;
  return true;
}
