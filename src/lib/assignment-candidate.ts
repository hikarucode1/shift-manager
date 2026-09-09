/**
 * 教室長が代理で何かを作るとき、確定シフトの 1 行を「選べるか」「どう注記するか」
 * (#217 / #227 / #215)。
 *
 * ⚠️ **`listAssignmentsForDate` の中に三項演算子で書かない** (#230)。用途 3 種 ×
 * 欠勤の状態 × 交代の有無 × 終了済み の組み合わせで、用途が増えるたびに注記が
 * 嘘になる。このリポジトリは「行の種類が増えるたびに嘘が出る」を admin 側で
 * 何度も踏んでいるので、判定はここに集約してテストで固定する。
 */

export type CandidatePurpose = "absence" | "swap" | "record";

export type CandidateState = {
  /**
   * 同一コマの欠勤申請の状態。
   *
   * ⚠️ **`pending` と `approved` を区別する** (#230)。`approved` は「休むことが
   * 確定していて代講が要る」、`pending` は「教室長がまだ判断していない」。
   * 一緒くたにすると、未承認の申請を「欠勤が確定した」と読ませる。
   */
  absence: "none" | "pending" | "approved";
  /** 同一コマに pending の交代申請があるか */
  hasPendingSwap: boolean;
  /** コマが既に終了しているか */
  isEnded: boolean;
};

export type CandidateMark = {
  /** その用途では選べない */
  blocked: boolean;
  /** 選択肢に添える短い注記。blocked の理由か、判断材料 */
  note: string | null;
};

export function candidateMark(
  purpose: CandidatePurpose,
  s: CandidateState,
): CandidateMark {
  // 欠勤の代理登録: 同一コマの pending/approved 欠勤が部分 unique で衝突する。
  // 終了済みでも選べる — 事後に実態を記録するのが目的 (#217)
  if (purpose === "absence") {
    if (s.absence !== "none") {
      return { blocked: true, note: "既に欠勤の申請あり" };
    }
    return { blocked: false, note: s.isEnded ? "実施済み" : null };
  }

  // 代講の代理募集: 同一コマの pending 交代が衝突する。加えて**終了済みは不可**
  // — 今から代わってもらう相手が居ないため (#178 と同じ規則、#227)
  if (purpose === "swap") {
    if (s.hasPendingSwap) return { blocked: true, note: "既に交代申請あり" };
    if (s.isEnded) return { blocked: true, note: "終了済み" };
    // ⚠️ 欠勤があっても塞がない —「欠勤が確定していて代講を探す」が本命。
    // ただし**未承認と承認済みを言い分ける** (#230)。教室長側の
    // `createOpenSwapOnBehalf` には講師側 (#33) のような欠勤ガードが無いので、
    // 未承認のまま募集 → 承認で欠勤が自動失効、という順序に到達できる。
    // ここで「未承認」と出すのが「先に承認/却下してください」の促しになる
    if (s.absence === "approved") {
      return { blocked: false, note: "欠勤あり（代講が必要）" };
    }
    if (s.absence === "pending") {
      return { blocked: false, note: "欠勤申請あり（未承認）" };
    }
    return { blocked: false, note: null };
  }

  // 代講の記録: **何も塞がない** (#215)。過去・未来どちらも記録の対象で、
  // 未処理の交代申請があっても記録はできる (記録後は承認できなくなるので
  // アクション側が戻り値で知らせる)
  const parts = [
    s.isEnded ? "実施済み" : null,
    s.hasPendingSwap ? "交代申請あり" : null,
  ].filter(Boolean);
  return { blocked: false, note: parts.join(" / ") || null };
}
