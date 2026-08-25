"use server";

import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  absenceRequests,
  profiles,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import { getSlotMeta } from "@/lib/slot-meta";
import { isValidIsoDate } from "@/lib/week";

export type AssignmentOption = {
  tutorId: string;
  tutorName: string;
  slotNumber: number;
  slotLabel: string;
  /** その用途では選べない (重複して作れない) コマ */
  blocked: boolean;
  /** 選択肢に添える短い注記。blocked の理由か、判断材料 */
  note: string | null;
};

/**
 * 指定日の確定シフト一覧 — 教室長が代理で何かを作るときの選択肢 (#217 / #227)。
 *
 * ⚠️ 日付で絞るだけで**過去日を除外しない**。呼び出し側の用途で扱いが違う:
 * 欠勤の代理登録 (#217) は過去日こそ本命、代講の代理募集 (#227) は当日以降のみ
 * (過去日は `decideSwapRequest` が承認を拒否するので死に行になる)。
 * **日付の制限はフォーム側とアクション側で行う。ここでは弾かない。**
 *
 * ⚠️ 出典は `weekly_shifts` なので、交代が承認済みのコマは**代講者**が出る。
 */
export async function listAssignmentsForDate(
  input: unknown,
): Promise<
  { ok: true; assignments: AssignmentOption[] } | { ok: false; error: string }
> {
  await requireRole("admin");

  const parsed = z
    .object({
      date: z.string().refine(isValidIsoDate, "日付が不正です。"),
      purpose: z.enum(["absence", "swap"]),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { date, purpose } = parsed.data;

  const meta = await getSlotMeta();
  const [shifts, absences, swaps] = await Promise.all([
    db
      .select({
        tutorId: weeklyShifts.tutorId,
        tutorName: profiles.displayName,
        slotNumber: weeklyShifts.slotNumber,
      })
      .from(weeklyShifts)
      .innerJoin(profiles, eq(profiles.id, weeklyShifts.tutorId))
      .where(eq(weeklyShifts.date, date))
      .orderBy(asc(weeklyShifts.slotNumber), asc(profiles.displayName)),
    db
      .select({
        tutorId: absenceRequests.tutorId,
        slotNumber: absenceRequests.slotNumber,
        status: absenceRequests.status,
      })
      .from(absenceRequests)
      .where(
        and(
          eq(absenceRequests.date, date),
          inArray(absenceRequests.status, ["pending", "approved"]),
        ),
      ),
    db
      .select({
        requesterId: swapRequests.requesterId,
        slotNumber: swapRequests.slotNumber,
      })
      .from(swapRequests)
      .where(
        and(
          eq(swapRequests.date, date),
          eq(swapRequests.status, "pending"),
        ),
      ),
  ]);

  const key = (t: string, n: number) => `${t}|${n}`;
  const absent = new Set(absences.map((a) => key(a.tutorId, a.slotNumber)));
  const swapping = new Set(swaps.map((s) => key(s.requesterId, s.slotNumber)));

  return {
    ok: true,
    assignments: shifts.map((s) => {
      const k = key(s.tutorId, s.slotNumber);
      // 欠勤の代理登録: 同一コマの pending/approved 欠勤が部分 unique で衝突する
      // 代講の代理募集: 同一コマの pending 交代が swap_requests_active_uniq で衝突する。
      //   欠勤があっても**塞がない** — 「欠勤が確定していて代講を探す」は #227 の本命
      const blocked = purpose === "absence" ? absent.has(k) : swapping.has(k);
      const note = blocked
        ? purpose === "absence"
          ? "既に欠勤の申請あり"
          : "既に交代申請あり"
        : purpose === "swap" && absent.has(k)
          ? "欠勤あり（代講が必要）"
          : null;
      return {
        tutorId: s.tutorId,
        tutorName: s.tutorName,
        slotNumber: s.slotNumber,
        slotLabel: meta.get(s.slotNumber)?.label ?? `${s.slotNumber}限`,
        blocked,
        note,
      };
    }),
  };
}
