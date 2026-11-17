import { SegmentedNav } from "@/components/segmented-nav";

/**
 * 講師「申請」タブ配下のサブナビ (#122 → #120 で SegmentedNav に集約)。
 * 下部タブの「申請」は欠勤/休み希望/交代/代講をまとめ、タブ自体は /tutor/absences に着地する
 * ため、ページ間の導線をここで補う。
 */
export function TutorRequestsNav() {
  return (
    <SegmentedNav
      items={[
        { href: "/tutor/absences", label: "欠勤申請" },
        // #360: まだシフトが出ていない先の日
        { href: "/tutor/day-offs", label: "休み希望" },
        { href: "/tutor/swaps", label: "交代申請" },
        { href: "/tutor/open-swaps", label: "代講募集" },
      ]}
    />
  );
}
