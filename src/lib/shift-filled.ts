import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { weeklyShifts } from "@/db/schema";
import type { Executor } from "@/lib/swaps";

/**
 * 室長レビュー要望9: そのコマに予定が入っているか。研修か、生徒 (体験を含む) が
 * 1 人でも入っていれば true。false =「未定」(座席表に講師の名前だけ)。
 *
 * ⚠️ `weekly_shifts` を**別名を付けずに** from / update / delete している文で
 * 使うこと。drizzle は相関サブクエリの中で外側の列のテーブル名を落とすため、
 * テーブル名を直書きしている (別名を付けると別のテーブルを指してしまう)。
 */
export const SHIFT_IS_FILLED = sql<boolean>`("weekly_shifts"."is_training" or exists (
  select 1 from "shift_assignments" sa
  where sa."weekly_shift_id" = "weekly_shifts"."id"
))`;

/**
 * そのコマの講師が、同じコマの代講を受けられない状態か。
 * - 予定が入っている (授業・研修)
 * - 未定でも、そのコマに欠勤の申請 (承認待ち・承認済み) がある
 *
 * 未定で欠勤も無い講師は、同じコマの代講を受けられる (引き受けたら
 * {@link removeUndecidedShift} で未定の行を消してから担当を付け替える)。
 * 使うときの注意は {@link SHIFT_IS_FILLED} と同じ。
 */
export const SHIFT_BLOCKS_SUBSTITUTION = sql<boolean>`(${SHIFT_IS_FILLED} or exists (
  select 1 from "absence_requests" ar
  where ar."tutor_id" = "weekly_shifts"."tutor_id"
    and ar."date" = "weekly_shifts"."date"
    and ar."slot_number" = "weekly_shifts"."slot_number"
    and ar."status" in ('pending', 'approved')
))`;

/**
 * その講師の、そのコマの「未定」の行を消す。予定が入っている行は消さない。
 *
 * 担当をこの講師へ付け替える直前に呼ぶ (代講の承認・引き受け、代講の取り消しで
 * 元の講師に戻すとき)。未定の行が残っていると
 * `weekly_shifts_unique (upload_id, tutor_id, date, slot_number)` に当たる。
 * 消した行数を返す。
 */
export async function removeUndecidedShift(
  executor: Executor,
  tutorId: string,
  date: string,
  slotNumber: number,
): Promise<number> {
  const removed = await executor
    .delete(weeklyShifts)
    .where(
      and(
        eq(weeklyShifts.tutorId, tutorId),
        eq(weeklyShifts.date, date),
        eq(weeklyShifts.slotNumber, slotNumber),
        sql`not ${SHIFT_IS_FILLED}`,
      ),
    )
    .returning({ id: weeklyShifts.id });
  return removed.length;
}
