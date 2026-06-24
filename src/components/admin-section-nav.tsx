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
 * トップナビ「期間管理」配下に 講習期間 / 月別提出期間 / レギュラー期間 /
 * 固定シフト俯瞰 を統合 (固定シフト俯瞰はレギュラー提出の俯瞰として同居)。
 */
export function AdminPeriodsNav() {
  return (
    <SegmentedNav
      items={[
        { href: "/admin/periods", label: "講習期間" },
        { href: "/admin/submission-periods", label: "月別提出期間" },
        { href: "/admin/regular-periods", label: "レギュラー期間" },
        { href: "/admin/fixed-shifts", label: "固定シフト俯瞰" },
      ]}
    />
  );
}
