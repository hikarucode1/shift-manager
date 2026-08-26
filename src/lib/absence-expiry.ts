/**
 * 交代成立で欠勤申請を自動失効させたときに `decision_note` へ残す印。
 *
 * ⚠️ **書く側 (交代の承認 / 代講の記録) と読む側 (失効件数の集計・台帳の
 * 種類判定) で共有する。** 片方だけ変えると数えられなくなる。
 *
 * ⚠️ この文字列一致だけで「自動失効」と断定しないこと。`cancelApprovedAbsence`
 * の理由欄は自由文なので、教室長が偶然同じ文言を書きうる。自動失効は必ず
 * `decided_by` が null になるので、**AND で判定する** (`request-log.ts` 参照)。
 */
export const ABSENCE_AUTO_EXPIRED_NOTE = "交代成立により自動失効";
