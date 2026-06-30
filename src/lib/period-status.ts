/**
 * 期間管理グループ (#126 UI 刷新) の状態バッジ用トークンと、提出受付の状態判定。
 * 月別提出 (submission-periods) とレギュラー (regular-periods) で共通利用する
 * (両画面で byte-identical に重複していたものを集約)。
 */

/** muted バッジ (開始前 / 締切後 など非アクティブ状態)。 */
export const MUTED_BADGE =
  "border-transparent bg-muted text-muted-foreground hover:bg-muted";

/** accent バッジ (受付中などアクティブ状態の強調)。 */
export const ACCENT_BADGE =
  "border-transparent bg-accent/15 text-accent hover:bg-accent/15";

/**
 * green バッジ (進行中 / 公開中などの成功状態)。
 * 緑は globals.css にセマンティックトークンが無く、アプリ全体 (tutors / training 等)
 * で `bg-green-50 text-green-700` リテラルを使う慣習に合わせている。
 * dark モードは現状未起動 (テーマトグル無し) のためリテラル固定で問題ないが、
 * 将来 dark 対応する際はこの 1 箇所を緑トークンに差し替えれば 3 画面に波及する。
 */
export const GREEN_BADGE =
  "border-transparent bg-green-50 text-green-700 hover:bg-green-50";

export type SubmissionStatus = {
  label: "開始前" | "受付中" | "締切後";
  /** 受付中のみ accent 強調。配色は UI 刷新デザインに準拠。 */
  active: boolean;
  className: string;
};

/**
 * 現在時刻 (ISO) と提出開始 / 締切 (ISO) から受付状態を判定。
 * opens は排他下限 (`<`)、due は排他上限 (`>`) ＝ 受付中は [opens, due] の閉区間。
 */
export function submissionStatus(
  nowIso: string,
  opensAt: string,
  dueAt: string,
): SubmissionStatus {
  const now = Date.parse(nowIso);
  if (now < Date.parse(opensAt))
    return { label: "開始前", active: false, className: MUTED_BADGE };
  if (now > Date.parse(dueAt))
    return { label: "締切後", active: false, className: MUTED_BADGE };
  return { label: "受付中", active: true, className: ACCENT_BADGE };
}
