"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { checkTeachingProfile } from "@/lib/tutor-subjects";
import { parseShiftReminderHours } from "@/lib/shift-reminder-rule";

/** #348: 講師が自分の文理・担当できる科目を登録する */

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveMyTeachingProfile(input: {
  track: unknown;
  subjects: unknown;
}): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const checked = checkTeachingProfile(input ?? {});
  if (!checked.ok) return checked;

  await db
    .update(profiles)
    .set({
      track: checked.track,
      teachableSubjects: checked.subjects,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/tutor/me");
  revalidatePath("/tutor");
  // #349: 教室長の一覧・詳細・担当科目の表にも同じ内容が出る
  revalidatePath("/admin/tutors");
  revalidatePath(`/admin/tutors/${profile.id}`);
  revalidatePath("/admin/tutor-subjects");
  return { ok: true };
}

/** メモ15: 出勤前のリマインドを何時間前に送るか (null = 送らない) */
export async function saveMyShiftReminder(input: {
  hours: unknown;
}): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = parseShiftReminderHours(input?.hours);
  if (!parsed.ok) return { ok: false, error: "選べない時間です。" };

  await db
    .update(profiles)
    .set({ shiftReminderHours: parsed.hours, updatedAt: new Date() })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/tutor/me");
  return { ok: true };
}
