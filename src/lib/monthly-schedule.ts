/**
 * 室長レビュー要望12 (2026/11/21 本人): 月のスケジュール (PDF) の決まりごと。
 * 教室長が月ごとにアップロードし、講師はアプリで開く。上げたら講師全員に通知。
 */

/** 1 ファイルの上限。サーバーアクションの受け取り上限 (next.config) より小さく */
export const MAX_SCHEDULE_PDF_BYTES = 4 * 1024 * 1024;

/** "2026-12" → "2026-12-01"。形が違えば null */
export function monthStartOf(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** "2026-12-01" → "2026年12月" */
export function monthLabel(monthStart: string): string {
  return `${monthStart.slice(0, 4)}年${Number(monthStart.slice(5, 7))}月`;
}

/** 中身が PDF か (先頭が "%PDF-") */
export function looksLikePdf(head: Uint8Array): boolean {
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return sig.every((b, i) => head[i] === b);
}

/**
 * PDF そのものの URL。
 *
 * ⚠️ 画面のリンクにそのまま使わないこと (`target="_blank"` でも)。ホーム画面に
 * 追加したアプリには戻るボタンが無く、PDF を開いたまま戻れなくなる
 * (2026/11/21 本人)。リンクは下の `*ScheduleViewPath` (アプリの画面の中に描く
 * ページ) に張る
 */
export function schedulePdfPath(monthStart: string): string {
  return `/schedules/${monthStart.slice(0, 7)}`;
}

export const TUTOR_SCHEDULES_PATH = "/tutor/schedules";
/** 教室長が月のスケジュールを上げる画面 */
export const ADMIN_SCHEDULES_PATH = "/admin/announcements";

/** 講師が PDF をアプリの画面の中で見るページ */
export function tutorScheduleViewPath(monthStart: string): string {
  return `${TUTOR_SCHEDULES_PATH}/${monthStart.slice(0, 7)}`;
}

/** 教室長が PDF をアプリの画面の中で見るページ */
export function adminScheduleViewPath(monthStart: string): string {
  return `${ADMIN_SCHEDULES_PATH}/schedules/${monthStart.slice(0, 7)}`;
}

/** アップロードしたときの通知 */
export function scheduleNotice(monthStart: string, replaced: boolean) {
  return {
    title: replaced
      ? `${monthLabel(monthStart)}のスケジュールが更新されました`
      : `${monthLabel(monthStart)}のスケジュールが出ました`,
    body: "休校日・時間割を確認してください",
    href: TUTOR_SCHEDULES_PATH,
  };
}

/** "2026-11-01" → "2026-12" (翌月の YYYY-MM)。教室長の画面の初期値 */
export function nextMonthOf(monthStart: string): string {
  const y = Number(monthStart.slice(0, 4));
  const m = Number(monthStart.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
