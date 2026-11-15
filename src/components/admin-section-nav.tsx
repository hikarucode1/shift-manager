import { SegmentedNav } from "@/components/segmented-nav";

/**
 * 管理者「講師管理」グループのサブナビ (#120)。
 * トップナビ「講師管理」配下に 講師 / 教室長 を統合。
 */
export function AdminTutorsNav() {
  return (
    <SegmentedNav
      items={[
        { href: "/admin/tutors", label: "講師" },
        { href: "/admin/admins", label: "教室長" },
      ]}
    />
  );
}

/**
 * 管理者「期間管理」グループのサブナビ (#120)。
 * トップナビ「期間管理」配下に 講習期間 / 月別提出期間 / レギュラー期間 を統合。
 * #329: 期間管理は期間の設定だけにした。レギュラーの提出内容 (旧「固定シフト俯瞰」)
 * は「シフト希望」グループへ移した (AdminShiftWishNav)。
 */
export function AdminPeriodsNav() {
  return (
    <SegmentedNav
      items={[
        { href: "/admin/periods", label: "講習期間" },
        { href: "/admin/submission-periods", label: "月別提出期間" },
        { href: "/admin/regular-periods", label: "レギュラー期間" },
      ]}
    />
  );
}

/**
 * 管理者「シフト希望」グループのサブナビ (#329)。講師が出した希望を見る画面を
 * まとめる: 講習 (ヒートマップ) / レギュラー (提出内容の一覧、旧「固定シフト俯瞰」)。
 * URL は変えていない。
 */
export function AdminShiftWishNav() {
  return (
    <SegmentedNav
      items={[
        { href: "/admin/training", label: "講習" },
        { href: "/admin/fixed-shifts", label: "レギュラー" },
      ]}
    />
  );
}
