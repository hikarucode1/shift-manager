/**
 * 室長レビュー要望7: 講習の希望入力で強調する「普段のレギュラー」を選ぶ。
 * DB を読む getUsualRegularSlots (training.ts) から使う
 */

/**
 * 講習期間の終わり (untilDate) までに始まっている行のうち、いちばん新しい日
 * (最後の期の終わり。untilDate を超えるなら untilDate) に効いている "weekday|slot"
 */
export function pickUsualRegularSlots(
  rows: {
    weekday: string;
    slotNumber: number;
    effectiveFrom: string;
    effectiveTo: string;
  }[],
  untilDate: string,
): string[] {
  const usable = rows.filter((r) => r.effectiveFrom <= untilDate);
  if (usable.length === 0) return [];
  const latestTo = usable.reduce(
    (m, r) => (r.effectiveTo > m ? r.effectiveTo : m),
    usable[0].effectiveTo,
  );
  const ref = latestTo < untilDate ? latestTo : untilDate;
  const keys = new Set(
    usable
      .filter((r) => r.effectiveFrom <= ref && ref <= r.effectiveTo)
      .map((r) => `${r.weekday}|${r.slotNumber}`),
  );
  return [...keys].sort();
}
