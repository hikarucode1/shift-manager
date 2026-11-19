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
        // 本番チェック メモ20: 「交代申請」は講師メニューから外した (交代は
        // 教室長が決める。指名された代講の引き受けは「代講募集」の画面)
        { href: "/tutor/open-swaps", label: "代講募集" },
      ]}
    />
  );
}
