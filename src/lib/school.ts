/**
 * 教室の連絡先。
 *
 * 2026/11/21 本人: 当日の欠勤はアプリでは受け付けず、電話で教室に連絡して
 * もらう。講師の画面の通知ベルの隣に、この番号への電話ボタンを置く。
 */
export const SCHOOL_PHONE = "03-5921-6777";

/** `tel:` リンク用 (ハイフンを除く) */
export const SCHOOL_PHONE_HREF = `tel:${SCHOOL_PHONE.replace(/-/g, "")}`;
