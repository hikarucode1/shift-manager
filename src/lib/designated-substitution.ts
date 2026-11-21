/**
 * #331: 欠勤で教室長が指定した「代講を頼む相手」への依頼の状態。
 *
 * 流れ: 講師が欠勤を申請 → 教室長が承認し、相手を指定 → 休む講師が相手に
 * 依頼 (`swap_requests` の named。`absence_request_id` で欠勤に紐づく) →
 * 相手が引き受けるとその場で成立 / 断ると閉じる (`close_kind =
 * nominee_declined`)。
 *
 * 画面 (休む講師の「欠勤等」) に何を出すかを、この関数 1 か所で決める。
 */
export type LinkedSwap = {
  status: "pending" | "approved" | "rejected" | "cancelled";
  nominatedTutorId: string | null;
  closeKind: string | null;
};

export type DesignationState =
  /** 指定が無い、または出すものが無い */
  | { kind: "none" }
  /** 依頼ボタンを出す */
  | { kind: "can-request" }
  /** 依頼済みで、相手の返事待ち */
  | { kind: "requested" }
  /** 相手が引き受けて成立した */
  | { kind: "accepted" }
  /** 相手が断った (教室長が次の相手を決めるのを待つ) */
  | { kind: "declined" };

export function designationState(i: {
  /** 欠勤の状態 */
  absenceStatus: "pending" | "approved" | "rejected" | "cancelled";
  /** 教室長が最後に指定した相手 (無ければ null) */
  designatedId: string | null;
  /** この欠勤に紐づく依頼 (新しい順でなくてよい) */
  linkedSwaps: readonly LinkedSwap[];
  /** コマが終わったか */
  isEnded: boolean;
}): DesignationState {
  if (i.designatedId === null && i.linkedSwaps.length === 0) {
    return { kind: "none" };
  }
  // 室長レビュー要望2: 相手は複数いる (早い者勝ち)。誰か 1 人でも引き受けたら
  // 成立。成立すると欠勤は自動失効するので、欠勤の状態より先に見る
  if (i.linkedSwaps.some((s) => s.status === "approved")) {
    return { kind: "accepted" };
  }
  if (i.absenceStatus !== "approved") return { kind: "none" };
  // 誰か 1 人でも返事待ちなら、まだ待つ
  if (i.linkedSwaps.some((s) => s.status === "pending")) {
    return { kind: "requested" };
  }
  // 最後に指定した相手への依頼がまだ無い (指定し直したが依頼を送れなかった)
  const forCurrent = i.linkedSwaps.filter(
    (s) => s.nominatedTutorId === i.designatedId,
  );
  if (i.designatedId !== null && forCurrent.length === 0) {
    return i.isEnded ? { kind: "none" } : { kind: "can-request" };
  }
  if (
    i.linkedSwaps.some(
      (s) => s.status === "cancelled" && s.closeKind === "nominee_declined",
    )
  ) {
    return { kind: "declined" };
  }
  if (i.isEnded || i.designatedId === null) return { kind: "none" };
  return { kind: "can-request" };
}
