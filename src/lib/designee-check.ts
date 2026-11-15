import "server-only";
import { and, arrayContains, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { isTutorBusyAt } from "@/lib/swaps";

/**
 * #331: 欠勤の「代講を頼む相手」に指定できるかを確かめる。欠勤の承認時
 * (`decideAbsenceRequest`) と、断られたあとの指定し直し
 * (`redesignateSubstitute`) で同じ決まりを使う。
 *
 * 休む本人以外の、有効な講師で、そのコマが空いている人だけ。指定できない
 * ときは画面に出す文言を返す。指定できるときは null
 */
export async function designeeError(i: {
  absentTutorId: string;
  designeeId: string;
  date: string;
  slotNumber: number;
}): Promise<string | null> {
  if (i.designeeId === i.absentTutorId) {
    return "休む講師本人は代講の相手に指定できません。";
  }
  const [nominee] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.id, i.designeeId),
        arrayContains(profiles.roles, ["tutor"]),
        eq(profiles.isActive, true),
      ),
    )
    .limit(1);
  if (!nominee) return "代講の相手に指定した講師が見つかりません。";
  if (await isTutorBusyAt(i.date, i.slotNumber, i.designeeId)) {
    return "指定した講師は同じコマに出勤予定です。別の講師を選んでください。";
  }
  return null;
}
