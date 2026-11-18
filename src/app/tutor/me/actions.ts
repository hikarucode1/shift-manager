"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { checkTeachingProfile } from "@/lib/tutor-subjects";

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
  revalidatePath("/admin/tutor-subjects");
  return { ok: true };
}
