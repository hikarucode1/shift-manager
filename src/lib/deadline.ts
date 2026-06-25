/**
 * 締切までの残り日数 (JST カレンダー日の差) からラベルと緊急フラグを導出する。
 * 講師スマホ画面 (#130 ホーム / #131 固定シフト ほか) で共通利用する純粋関数。
 *
 * - daysLeft < 0  … 締切超過 (urgent)
 * - daysLeft === 0 … 本日締切 (urgent)
 * - 1 <= daysLeft <= 3 … あとN日 (urgent: 近接)
 * - daysLeft >= 4 … あとN日 (非緊急)
 */
export function deadlineLabel(daysLeft: number): {
  text: string;
  urgent: boolean;
} {
  if (daysLeft < 0) return { text: "締切超過", urgent: true };
  if (daysLeft === 0) return { text: "本日締切", urgent: true };
  return { text: `あと${daysLeft}日`, urgent: daysLeft <= 3 };
}
