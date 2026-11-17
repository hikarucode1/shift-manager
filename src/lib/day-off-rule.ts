/**
 * #360: 先の日の休み希望の決まりごと (DB に触らない部分)。
 */

/**
 * 休み希望のコマの書き方。空なら終日。コマの名前は教室長が変えられるので
 * 分かっていれば label で渡す
 */
export function dayOffSlotsLabel(
  slotNumbers: readonly number[],
  label: (n: number) => string = (n) => `${n}限`,
): string {
  if (slotNumbers.length === 0) return "終日";
  return [...slotNumbers]
    .sort((a, b) => a - b)
    .map(label)
    .join("・");
}

/** その休み希望がこのコマを含むか (終日ならどのコマも含む) */
export function dayOffCovers(
  slotNumbers: readonly number[],
  slotNumber: number,
): boolean {
  return slotNumbers.length === 0 || slotNumbers.includes(slotNumber);
}

export type DayOffLike = {
  tutorId: string;
  date: string;
  slotNumbers: readonly number[];
};

export type ShiftLike = { tutorId: string; date: string; slotNumber: number };

/** 承認済みの休みの日に入っているシフト (講師・日付・コマ) */
export function findDayOffConflicts<S extends ShiftLike>(
  dayOffs: readonly DayOffLike[],
  shifts: readonly S[],
): S[] {
  const byKey = new Map<string, DayOffLike[]>();
  for (const d of dayOffs) {
    const k = `${d.tutorId}|${d.date}`;
    byKey.set(k, [...(byKey.get(k) ?? []), d]);
  }
  return shifts.filter((s) =>
    (byKey.get(`${s.tutorId}|${s.date}`) ?? []).some((d) =>
      dayOffCovers(d.slotNumbers, s.slotNumber),
    ),
  );
}

/** コマの入力を揃える (重複を除いて昇順) */
export function normalizeSlotNumbers(slotNumbers: readonly number[]): number[] {
  return [...new Set(slotNumbers)].sort((a, b) => a - b);
}
