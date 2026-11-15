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
  /** 教室長が指定した相手 (無ければ null) */
  designatedId: string | null;
  /** この欠勤に紐づく依頼 (新しい順でなくてよい) */
  linkedSwaps: readonly LinkedSwap[];
  /** コマが終わったか */
  isEnded: boolean;
}): DesignationState {
  if (i.designatedId === null) return { kind: "none" };
  // 今の指定相手への依頼だけを見る (教室長が指定し直したら、前の相手への
  // 依頼の結果は関係ない)
  const forCurrent = i.linkedSwaps.filter(
    (s) => s.nominatedTutorId === i.designatedId,
  );
  // 成立すると欠勤は自動失効するので、欠勤の状態より先に見る
  if (forCurrent.some((s) => s.status === "approved")) {
    return { kind: "accepted" };
  }
  if (i.absenceStatus !== "approved") return { kind: "none" };
  if (forCurrent.some((s) => s.status === "pending")) {
    return { kind: "requested" };
  }
  if (
    forCurrent.some(
      (s) => s.status === "cancelled" && s.closeKind === "nominee_declined",
    )
  ) {
    return { kind: "declined" };
  }
  if (i.isEnded) return { kind: "none" };
  return { kind: "can-request" };
}
