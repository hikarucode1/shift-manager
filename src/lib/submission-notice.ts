import type { NotificationInput } from "@/lib/notifications";

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
