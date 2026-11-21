/**
 * #339: 進行表 (Google スプレッドシート) の URL。
 *
 * 教室長が登録し、講師のホームと教室長のダッシュボードから開く。
 * アプリが渡すのはリンクだけで、誰が中を見られるかはスプレッドシート側の
 * 共有設定のまま。
 */

/** app_settings のキー */
export const PROGRESS_SHEET_KEY = "progress_sheet_url";

/** 室長レビュー要望13: 講師マニュアル (スプレッドシート) の URL のキー */
export const TUTOR_MANUAL_KEY = "tutor_manual_url";

/**
 * 教室長が URL を登録して講師のホームから開くスプレッドシート。
 * 進行表 (#339) と講師マニュアル (要望13) は同じ仕組みで、キーと表示だけが違う。
 */
export const SHEET_LINKS = {
  progress: {
    key: PROGRESS_SHEET_KEY,
    title: "進行表",
    openLabel: "進行表を開く",
  },
  manual: {
    key: TUTOR_MANUAL_KEY,
    title: "講師マニュアル",
    openLabel: "講師マニュアルを開く",
  },
} as const;

export type SheetLinkKind = keyof typeof SHEET_LINKS;
export const SHEET_LINK_KINDS = Object.keys(SHEET_LINKS) as SheetLinkKind[];

/** 登録できる URL の長さの上限 (スプレッドシートの URL は 100 字程度) */
const MAX_LENGTH = 2000;

/**
 * 入力された URL を確かめて、保存する形に整える。
 * - 前後の空白は落とす。空なら「登録を消す」(null)
 * - https の Google スプレッドシート (docs.google.com/spreadsheets/...) だけ
 *   受け付ける。打ち間違いや別のサイトへのリンクを講師に配らないため
 */
export function normalizeProgressSheetUrl(
  input: string,
): { ok: true; url: string | null } | { ok: false; error: string } {
  const s = input.trim();
  if (s === "") return { ok: true, url: null };
  if (s.length > MAX_LENGTH) {
    return { ok: false, error: "URL が長すぎます。" };
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "URL の形になっていません。" };
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== "docs.google.com" ||
    !u.pathname.startsWith("/spreadsheets/")
  ) {
    return {
      ok: false,
      error:
        "Google スプレッドシートの URL (https://docs.google.com/spreadsheets/…) を貼ってください。",
    };
  }
  return { ok: true, url: u.toString() };
}
