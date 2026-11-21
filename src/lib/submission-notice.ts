import type { NotificationInput } from "@/lib/notifications";
import { noticeDate } from "@/lib/week";

/**
 * #338: 講師がレギュラーシフトを提出したときの、教室長向けの通知。
 * 押すとその期の開始月の「シフト希望 (レギュラー)」一覧を開く。
 */
export function regularSubmittedNotice(
  tutorName: string,
  effectiveFrom: string,
): Omit<NotificationInput, "audience"> {
  const [y, m] = effectiveFrom.split("-");
  return {
    type: "shift_submitted",
    title: `${tutorName}さんがレギュラーシフトを提出しました`,
    body: `${Number(y)}年${Number(m)}月からの分`,
    href: `/admin/fixed-shifts?month=${y}-${m}-01`,
  };
}

/**
 * #338: 講師が欠勤申請を出したときの、教室長向けの通知。
 * 欠勤は代講探しをすぐ始める必要があるので知らせる。押すと申請承認 (未対応) を開く。
 */
export function absenceRequestedNotice(
  tutorName: string,
  /** 室長レビュー要望1: まとめて出したときは複数 */
  targets: { date: string; slotLabel: string }[],
  reason: string,
): Omit<NotificationInput, "audience"> {
  // 理由は最大 500 字。通知では頭だけ見せ、全文は申請承認で読む
  const short = reason.length > 60 ? `${reason.slice(0, 60)}…` : reason;
  return {
    type: "absence_requested",
    title:
      targets.length > 1
        ? `${tutorName}さんから欠勤申請が ${targets.length} コマ分届きました`
        : `${tutorName}さんから欠勤申請が届きました`,
    body: `対象: ${listLabel(targets.map((t) => `${noticeDate(t.date)} ${t.slotLabel}`))} ／ 理由: ${short}`,
    href: "/admin/requests",
  };
}

/** 通知の本文に並べる対象。多いときは 3 件まで出して「ほか N 件」 */
export function listLabel(items: string[]): string {
  if (items.length <= 3) return items.join("、");
  return `${items.slice(0, 3).join("、")} ほか ${items.length - 3} 件`;
}
