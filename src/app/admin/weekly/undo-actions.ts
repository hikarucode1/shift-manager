"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, asc, between, eq, inArray } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  absenceRequests,
  profiles,
  shiftConfirmations,
  shiftUploads,
  swapRequests,
} from "@/db/schema";
import { isValidIsoDate, noticeDate, weekOf } from "@/lib/week";
import { getSlotMeta } from "@/lib/slot-meta";

const Input = z.object({
  weekStart: z.string().refine(isValidIsoDate, "週の指定が正しくありません。"),
});

export type UndoWeekResult =
  | { ok: true }
  | { ok: false; error: string; blockers?: string[] };

/**
 * 本番チェック メモ16: 取り込んで登録した座席表 (1 週分) を取り消す。
 *
 * その週の `shift_uploads` を消すと、`weekly_shifts` → `shift_assignments`
 * は外部キーの cascade で一緒に消える。講師の「この週のシフトを確認した」
 * 記録も、消した座席表に対するものなので消す。講師への通知はしない
 * (間違いを消すための操作のため)。
 *
 * ⚠️ その週に承認済み・返事待ちの欠勤や代講があるときは取り消さない。
 * 代講・欠勤は日付とコマで持っているので、座席表だけ消すと表とずれる。
 * 何が残っているかを返し、先にそちらを片付けてもらう。
 */
export async function undoWeekUpload(input: unknown): Promise<UndoWeekResult> {
  await requireRole("admin");
  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "入力が不正です。" };
  }
  const range = weekOf(parsed.data.weekStart);

  const [absences, swaps, slotMeta] = await Promise.all([
    db
      .select({
        date: absenceRequests.date,
        slotNumber: absenceRequests.slotNumber,
        status: absenceRequests.status,
        name: profiles.displayName,
      })
      .from(absenceRequests)
      .innerJoin(profiles, eq(profiles.id, absenceRequests.tutorId))
      .where(
        and(
          between(absenceRequests.date, range.start, range.end),
          inArray(absenceRequests.status, ["pending", "approved"]),
        ),
      )
      .orderBy(asc(absenceRequests.date), asc(absenceRequests.slotNumber)),
    db
      .select({
        date: swapRequests.date,
        slotNumber: swapRequests.slotNumber,
        status: swapRequests.status,
        name: profiles.displayName,
      })
      .from(swapRequests)
      .innerJoin(profiles, eq(profiles.id, swapRequests.requesterId))
      .where(
        and(
          between(swapRequests.date, range.start, range.end),
          inArray(swapRequests.status, ["pending", "approved"]),
        ),
      )
      .orderBy(asc(swapRequests.date), asc(swapRequests.slotNumber)),
    getSlotMeta(),
  ]);
  const label = (n: number) => slotMeta.get(n)?.label ?? `${n}限`;
  const blockers = [
    ...absences.map(
      (a) =>
        `欠勤（${a.status === "approved" ? "承認済み" : "承認待ち"}）: ${a.name} ${noticeDate(a.date)} ${label(a.slotNumber)}`,
    ),
    ...swaps.map(
      (s) =>
        `代講（${s.status === "approved" ? "決定済み" : "返事待ち・募集中"}）: ${s.name} ${noticeDate(s.date)} ${label(s.slotNumber)}`,
    ),
  ];
  if (blockers.length > 0) {
    return {
      ok: false,
      error:
        "この週には欠勤や代講が残っているため、取り消せません。先に「申請」の画面で取り消してから、もう一度お試しください。",
      blockers,
    };
  }

  try {
    const deletedUploads = await db.transaction(async (tx) => {
      const uploads = await tx
        .delete(shiftUploads)
        .where(eq(shiftUploads.weekStart, range.start))
        .returning({ id: shiftUploads.id });
      await tx
        .delete(shiftConfirmations)
        .where(eq(shiftConfirmations.weekStart, range.start));
      return uploads.length;
    });
    if (deletedUploads === 0) {
      return { ok: false, error: "この週に取り消せる座席表がありません。" };
    }
  } catch (e) {
    console.error("undoWeekUpload failed", e);
    return { ok: false, error: "取り消せませんでした。時間をおいてもう一度お試しください。" };
  }

  revalidatePath("/admin/weekly");
  revalidatePath("/admin/uploads");
  revalidatePath("/tutor");
  return { ok: true };
}
