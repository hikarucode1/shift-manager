"use server";

import { z } from "zod";
import { and, arrayContains, asc, eq, inArray, ne } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  absenceRequests,
  profiles,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import { candidateMark } from "@/lib/assignment-candidate";
import { getSlotMeta } from "@/lib/slot-meta";
import { isSlotPast } from "@/lib/slot-time";
import { isValidIsoDate } from "@/lib/week";

export type AssignmentOption = {
  tutorId: string;
  tutorName: string;
  slotNumber: number;
  slotLabel: string;
  /** コマが既に終了しているか。欠勤は選べる (むしろ本命)、代講の募集は不可 */
  isEnded: boolean;
  /** その用途では選べないコマ */
  blocked: boolean;
  /** 選択肢に添える短い注記。blocked の理由か、判断材料 */
  note: string | null;
};

/**
 * 指定日の確定シフト一覧 — 教室長が代理で何かを作るときの選択肢 (#217 / #227)。
 *
 * ⚠️ 日付で絞るだけで**過去日を除外しない**。呼び出し側の用途で扱いが違う:
 * 欠勤の代理登録 (#217) と代講の記録 (#215) は過去こそ本命、代講の代理募集
 * (#227) は終了していないコマのみ (終了後に募集しても代わってもらう相手が
 * 居ない)。**日付の制限はフォーム側とアクション側で行う。ここでは弾かない。**
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
      purpose: z.enum(["absence", "swap", "record"]),
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
        date: weeklyShifts.date,
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
  // ⚠️ **status を捨てない** (#230)。従来は Set にしていたので `pending` の
  // 欠勤申請でも「欠勤あり（代講が必要）」と出て、教室長がまだ判断していない
  // 申請を「欠勤が確定した」と読ませていた。
  //
  // ⚠️ 同一コマに pending と approved が同居することは
  // `absence_requests_active_uniq` (部分 unique) が防いでいるので、後勝ちで
  // 潰れる心配は無い
  const absentBy = new Map(
    absences.map((a) => [key(a.tutorId, a.slotNumber), a.status] as const),
  );
  const swapping = new Set(swaps.map((s) => key(s.requesterId, s.slotNumber)));

  return {
    ok: true,
    assignments: shifts.map((s) => {
      const k = key(s.tutorId, s.slotNumber);
      const slot = meta.get(s.slotNumber);
      const isEnded = isSlotPast(s.date, slot?.end ?? "");
      // ⚠️ 判定は `candidateMark` に集約してある (#230)。ここに
      // `purpose === "swap" && …` を書き足さないこと — 用途が増えるたびに
      // 注記が嘘になる
      const { blocked, note } = candidateMark(purpose, {
        absence:
          (absentBy.get(k) as "pending" | "approved" | undefined) ?? "none",
        hasPendingSwap: swapping.has(k),
        isEnded,
      });
      return {
        tutorId: s.tutorId,
        tutorName: s.tutorName,
        slotNumber: s.slotNumber,
        slotLabel: slot?.label ?? `${s.slotNumber}限`,
        isEnded,
        blocked,
        note,
      };
    }),
  };
}


/**
 * 指定コマの代講者候補 (#215)。現役の tutor から、担当本人と**そのコマに
 * 既に出勤予定の講師**を除く (`weekly_shifts_unique` に当たるため)。
 * `getEligibleApplicantIds` の氏名つき版で、判定条件は同じ。
 */
export async function listEligibleSubstitutes(
  input: unknown,
): Promise<
  | { ok: true; tutors: { id: string; name: string }[] }
  | { ok: false; error: string }
> {
  await requireRole("admin");

  const parsed = z
    .object({
      date: z.string().refine(isValidIsoDate, "日付が不正です。"),
      slotNumber: z.number().int().min(1).max(20),
      excludeTutorId: z.string().uuid(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { date, slotNumber, excludeTutorId } = parsed.data;

  const [candidates, assigned] = await Promise.all([
    db
      .select({ id: profiles.id, name: profiles.displayName })
      .from(profiles)
      .where(
        and(
          arrayContains(profiles.roles, ["tutor"]),
          eq(profiles.isActive, true),
          ne(profiles.id, excludeTutorId),
        ),
      )
      .orderBy(asc(profiles.displayName)),
    db
      .select({ tutorId: weeklyShifts.tutorId })
      .from(weeklyShifts)
      .where(
        and(
          eq(weeklyShifts.date, date),
          eq(weeklyShifts.slotNumber, slotNumber),
        ),
      ),
  ]);
  const busy = new Set(assigned.map((r) => r.tutorId));
  return { ok: true, tutors: candidates.filter((c) => !busy.has(c.id)) };
}
