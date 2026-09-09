/**
 * 代講募集を「応募できる一覧」(`/tutor/open-swaps`) に出すかどうか (#259)。
 *
 * ⚠️ **判定は `decideSwapRequest` が付け替えに使う条件と同じにしてある** —
 * 「申請者が今もそのコマの担当か」。承認が成立する条件そのものなので、
 * ここを独自の条件にすると「一覧には出るが承認できない」がまた生まれる。
 *
 * ⚠️ **講師側の 2 面 (一覧と応募) にしか入っていない。** 教室長の「未対応」
 * タブは承認できない募集を承認ボタン付きで出したままで、押すと必ず
 * 「付け替え対象の確定シフトが見つかりません」になる。同じ dead button が
 * admin 側に残っている — #262 に分離した。
 *
 * ⚠️ **担当は戻る方向にも動く。** `cancelApprovedSwap` は代講者から申請者へ
 * 戻し、CSV 再取り込み (`upload-commit`) は weekly_shifts を CSV の原状に
 * 作り直す。承認不能だった募集が**再び承認可能になる**ので、`swap_requests`
 * に「承認不能」フラグを持たせる設計は取れない。毎回その場で判定する。
 */

export type OpenSwapRow = {
  id: string;
  kind: string;
  requesterId: string;
  nominatedTutorId: string | null;
  date: string;
  slotNumber: number;
};

/** `weekly_shifts` の (担当者, 日, コマ) を集合で引くためのキー */
export function assignmentKey(
  tutorId: string,
  date: string,
  slotNumber: number,
): string {
  return `${tutorId}|${date}|${slotNumber}`;
}

/**
 * @param appliedIds 自分が応募中 (取り下げていない) の募集 id
 * @param assignedKeys `weekly_shifts` に実在する (担当者, 日, コマ)
 */
export function visibleOpenSwaps<T extends OpenSwapRow>(
  rows: readonly T[],
  tutorId: string,
  appliedIds: ReadonlySet<string>,
  assignedKeys: ReadonlySet<string>,
): T[] {
  return rows.filter((r) => {
    // ⚠️ **allowlist にする。** `swap_kind` には `recorded` (#215) もあり、
    // 「named でなければ見せる」と書くと**将来の値に対して fail-open** になる。
    // 記録は `status: "approved"` で作られるので今は一覧のクエリ
    // (`status='pending'`) に載らないが、そこに寄りかかると
    // 「誰も出していない募集が全講師に応募可能として出る」で気づくことになる
    if (r.kind !== "open" && r.kind !== "named") return false;
    // 指名 (named) は自分が指名先のものだけ見える。open は全員
    if (r.kind === "named" && r.nominatedTutorId !== tutorId) return false;

    // ⚠️ **応募済みなら、承認不能でも残す。** 取り下げの導線はこの一覧にしか
    // 無く、落とすと**取り下げ不能な応募**になる。#165 で過去日を一覧から
    // 除外して同じ穴を開け、`getOpenSwapsForTutor` の冒頭にその戒めが残って
    // いる。承認できない件は #253 で本人に通知済み
    if (appliedIds.has(r.id)) return true;

    // 申請者が担当でなくなった募集は `decideSwapRequest` が必ず
    // 「付け替え対象の確定シフトが見つかりません」で落とす。**新しい応募を
    // 入れさせない** (#259)
    return assignedKeys.has(assignmentKey(r.requesterId, r.date, r.slotNumber));
  });
}
