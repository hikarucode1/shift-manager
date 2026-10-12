import { isSlotPast } from "@/lib/slot-time";
import { jstToday } from "@/lib/week";

/**
 * 交代成立で欠勤申請を自動失効させたときに `decision_note` へ残す文言
 * (交代の承認 / 代講の記録で、元講師がコマを失うとき)。台帳のコメント欄に出る。
 * 代講の取り消しで代講者がコマを失うときは `ABSENCE_EXPIRED_UNASSIGNED_NOTE`
 * (下)。
 *
 * ⚠️ **種類の判定には使わない。** 判定は `close_kind = 'auto_expired'` で行う
 * (#292)。以前はこの文言と `decided_by` が null であることの AND で判定して
 * いたが、教室長の取り消し理由が偶然一致すると分類が変わった。
 */
export const ABSENCE_AUTO_EXPIRED_NOTE = "交代成立により自動失効";

/**
 * 代講の取り消しで、**代講者が担当でなくなった**ときに、その代講者が同じコマに
 * 出していた欠勤申請を自動失効させる印 (#291)。
 *
 * `ABSENCE_AUTO_EXPIRED_NOTE` とは**分ける**。あちらは「交代が成立して元講師が
 * コマを失った」で、取り消しのときの失効件数の集計 (「登録し直してください」
 * の案内) と、講師の履歴の「代講が入ったため不要」の文言がそれを前提にしている。
 * 同じ印を使うと、代講者の失効まで「交代成立で失効した」と数えられ、表示も
 * 逆の意味になる (PR #298 のレビュー)。
 *
 * 判定は `close_kind = 'expired_unassigned'` で行う (#292)。この文言は
 * 台帳のコメント欄に出すだけ。
 */
export const ABSENCE_EXPIRED_UNASSIGNED_NOTE = "担当でなくなったため自動失効";

/**
 * 代講を取り消したとき、代講者がそのコマに出していた欠勤を失効させるか (#291)。
 *
 * - **これから先のコマ**: 失効させる。残すと、代講者があとで担当に戻ったとき
 *   欠勤マークが付き、新しい欠勤も一意制約で出せない
 * - **終わったコマ**: 失効させない。代講が取り消された (代講者は入らなかった)
 *   ので、代講者の欠勤は「実際に休んだ記録」のまま意味を持つ
 * - **今日で、コマの終了時刻が分からない** (コマ定義が無効化されている等):
 *   失効させない。分からないときは記録を残す側に倒す (`isSlotPast` は空の
 *   終了時刻を「終わっていない」と読むので、そのまま使うと逆に倒れる)
 *
 * ⚠️ 元講師の欠勤は、交代の承認・代講の記録で、終わったコマでも失効させる
 * (#33)。意味が違う: そちらは代講者が実際に入ったので、元講師の欠勤は
 * 「代講で埋まった」と片付いた状態。失効は台帳に「失効（交代成立による）」と
 * して残る
 */
export function shouldExpireSubstituteAbsence(
  date: string,
  slotEnd: string | undefined,
  now: Date = new Date(),
): boolean {
  const today = jstToday(now);
  if (date > today) return true;
  if (date < today) return false;
  if (!slotEnd) return false;
  return !isSlotPast(date, slotEnd, now);
}
