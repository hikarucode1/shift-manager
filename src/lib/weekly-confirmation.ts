import { weekOf } from "@/lib/week";

/**
 * #317: 講師が公開済みの週のシフトを確認した記録まわりの判定。
 */

export type SlotCell = { tutorId: string; date: string; slotNumber: number };

/**
 * 座席表の取り込み直しで、コマ (日付 × 何限) が変わった (講師, 週) の組。
 * この組の確認だけを外して、確認し直してもらう。
 *
 * - 担当する生徒だけの変更は数えない (本人の判断、2026-11-15)。コマの集合
 *   だけを比べる
 * - 週は月曜始まり (`weekOf`)。取り込みの単位と同じ
 * - 取り込む前にコマが無かった講師も「変わった」に入るが、その週の確認は
 *   まだ無いので、消す行が無いだけ
 */
export function changedTutorWeeks(
  before: readonly SlotCell[],
  after: readonly SlotCell[],
): { tutorId: string; weekStart: string }[] {
  const key = (c: SlotCell) =>
    `${c.tutorId}|${weekOf(c.date).start}`;
  const cell = (c: SlotCell) => `${c.date}|${c.slotNumber}`;
  const group = (cells: readonly SlotCell[]) => {
    const m = new Map<string, Set<string>>();
    for (const c of cells) {
      const k = key(c);
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(cell(c));
    }
    return m;
  };
  const b = group(before);
  const a = group(after);
  const out: { tutorId: string; weekStart: string }[] = [];
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(k) ?? new Set<string>();
    const y = a.get(k) ?? new Set<string>();
    const same = x.size === y.size && [...x].every((v) => y.has(v));
    if (!same) {
      const [tutorId, weekStart] = k.split("|");
      out.push({ tutorId, weekStart });
    }
  }
  return out;
}

/**
 * 教室長の「登録済みシフト」に出す、週の確認状況。その週にコマがある講師
 * だけを数える
 */
export function confirmationSummary(
  tutorsWithShifts: readonly { id: string; name: string }[],
  confirmedTutorIds: ReadonlySet<string>,
): { confirmed: number; total: number; unconfirmedNames: string[] } {
  const unconfirmed = tutorsWithShifts.filter(
    (t) => !confirmedTutorIds.has(t.id),
  );
  return {
    confirmed: tutorsWithShifts.length - unconfirmed.length,
    total: tutorsWithShifts.length,
    unconfirmedNames: unconfirmed.map((t) => t.name),
  };
}
