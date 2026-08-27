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
  /** 募集が取り下げられた (申請者本人 / 教室長のどちらも) */
  | "withdrawn";

export const OUTCOME_LABEL: Record<ApplicationOutcome, string> = {
  chosen: "あなたに決まりました",
  "not-chosen": "他の講師に決まりました",
  rejected: "却下されました",
  withdrawn: "取り下げられました",
};

/**
 * ⚠️ `pending` は渡さないこと。応募中の募集は `/tutor/open-swaps` の一覧に
 * 「応募済み」として出ており、結果一覧の対象ではない。
 */
export function applicationOutcome(
  status: "approved" | "rejected" | "cancelled",
  chosen: boolean,
): ApplicationOutcome {
  if (status === "rejected") return "rejected";
  if (status === "cancelled") return "withdrawn";
  return chosen ? "chosen" : "not-chosen";
}
