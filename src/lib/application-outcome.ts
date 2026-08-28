/**
 * 「自分が関わった代講」がどうなったか (#245 / #247)。
 *
 * 応募者から見た結果は 4 通りあり、`status` だけでは足りない (approved でも
 * **自分が選ばれたかどうか**で意味が正反対になる)。画面で
 * `status === "approved" ? … : …` と書くと、今日 admin 側で 3 回起きた
 * 「行の種類が増えるたびに嘘が出る」を講師側でも繰り返すので、ここに集約する。
 */
export type ApplicationOutcome =
  /** 応募して自分が代講者に決まった */
  | "chosen"
  /**
   * 応募していないのに教室長が代講者として記録した (#215)。`chosen` と分ける —
   * 自分で手を挙げたのか、教室長が入れたのかは本人にとって別の出来事で、
   * 「決まりました」と出すと申し込んだ覚えのないものを申し込んだことになる
   */
  | "recorded"
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
  recorded: "教室長が代講として記録しました",
  "not-chosen": "他の講師に決まりました",
  rejected: "却下されました",
  withdrawn: "取り下げられました",
  "cancelled-after-approval": "決まった代講が取り消されました",
};

/**
 * ⚠️ `pending` は渡さないこと。応募中の募集は `/tutor/open-swaps` の一覧に
 * 「応募済み」として出ており、結果一覧の対象ではない。
 *
 * ⚠️ `applied === false && chosen === false` は呼び出し側で除くこと
 * (自分と無関係な募集)。ここでは `not-chosen` に落ちる。
 */
export function applicationOutcome(
  status: "approved" | "rejected" | "cancelled",
  chosen: boolean,
  /** `approved_applicant_id` が入っているか (= 一度は承認された) */
  wasApproved: boolean,
  /**
   * 自分が応募したか (取り下げ済みは false)。応募していないのに代講者なら
   * 教室長の記録 (#215)。
   *
   * ⚠️ **この判定は `withdrawApplication` のガードに依存している。** あちらが
   * 「承認済みで自分が採用された応募は取り下げ不可」を守っているから、
   * `chosen` な講師の応募行が消えない。将来「決まったが行けなくなった」を
   * 取り下げで表せるように緩めると、**選ばれた講師が黙って「教室長が記録」に
   * 変わる**。
   */
  applied: boolean,
): ApplicationOutcome {
  if (status === "rejected") return "rejected";
  if (status === "cancelled") {
    return wasApproved ? "cancelled-after-approval" : "withdrawn";
  }
  if (!chosen) return "not-chosen";
  return applied ? "chosen" : "recorded";
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

export type MyApplication = {
  /** `swap_requests.id` (応募していない記録もあるので application の id ではない) */
  id: string;
  date: string;
  slotNumber: number;
  slotLabel: string;
  weekdayLabel: string;
  /** 募集を出した (= 休む) 講師 */
  requesterName: string;
  outcome: ApplicationOutcome;
  /** 却下理由・取り消し理由。見せてよい場合のみ入る */
  note: string | null;
  /** 結果が確定した日時 (並び順のキー) */
  decidedAt: string;
};

/** `getTutorApplications` の 1 行ぶんの入力 (DB 型に依存させない) */
export type ApplicationRowInput = {
  id: string;
  /** 生の status。`pending` が混ざりうる前提で受ける */
  status: string;
  date: string;
  slotNumber: number;
  slotLabel: string;
  weekdayLabel: string;
  requesterName: string;
  /** 申請時の理由。記録 (#215) では教室長が書いた経緯が入る */
  reason: string;
  /** 自分の応募行の id。取り下げ済み / 未応募なら null */
  applicationId: string | null;
  approvedApplicantId: string | null;
  note: string | null;
  decidedAt: string | null;
  updatedAt: string;
};

/**
 * DB の 1 行 → 画面に出す 1 行 (#247)。
 *
 * ⚠️ **ここを純関数にしてある理由**: `chosen` / `wasApproved` / `applied` の
 * 組み立てが `applicationOutcome` の正しさを決めるのに、DB 関数の中に置くと
 * テストできない。実際 #248 のレビューで `applicationId !== null` を `true` に
 * 変異させても全テストが通る状態だった (= 記録と当選を分ける 1 行が無検証)。
 *
 * ⚠️ `pending` は `null` を返す。応募中は募集一覧に「応募済み」として出て
 * おり、結果一覧の対象ではない。キャストで型任せにしない。
 */
export function toApplicationRow(
  r: ApplicationRowInput,
  tutorId: string,
): MyApplication | null {
  if (r.status !== "approved" && r.status !== "rejected" && r.status !== "cancelled") {
    return null;
  }
  const chosen = r.approvedApplicantId === tutorId;
  const outcome = applicationOutcome(
    r.status,
    chosen,
    r.approvedApplicantId !== null,
    r.applicationId !== null,
  );
  return {
    id: r.id,
    date: r.date,
    slotNumber: r.slotNumber,
    slotLabel: r.slotLabel,
    weekdayLabel: r.weekdayLabel,
    requesterName: r.requesterName,
    outcome,
    // ⚠️ 記録 (#215) の経緯は `reason` に入る (`decision_note` は空)。
    // decision_note だけを見ると **「なぜ自分が代講に入ったことになっているか」
    // が一覧から分からない** (#251)。記録以外は従来どおり決定時のコメント
    note:
      outcome === "recorded"
        ? r.reason
        : canSeeDecisionNote(outcome, chosen)
          ? r.note
          : null,
    decidedAt: r.decidedAt ?? r.updatedAt,
  };
}
