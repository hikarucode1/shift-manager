"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { ALL_SUBJECT_KEYS, normalizeSubjects, TRACKS } from "@/lib/tutor-subjects";

/** #348: 講師が自分の文理・担当できる科目を登録する */

type ActionResult = { ok: true } | { ok: false; error: string };

const trackKeys = TRACKS.map((t) => t.key) as [string, ...string[]];

const Input = z.object({
  track: z.enum(trackKeys).nullable(),
  subjects: z
    .array(z.string().refine((k) => ALL_SUBJECT_KEYS.includes(k)))
    .max(ALL_SUBJECT_KEYS.length),
});

export async function saveMyTeachingProfile(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  if (!parsed.data.track) {
    return { ok: false, error: "理系・文系を選んでください。" };
  }
  const subjects = normalizeSubjects(parsed.data.subjects);
  if (subjects.length === 0) {
    return { ok: false, error: "担当できる科目を 1 つ以上選んでください。" };
  }

  await db
    .update(profiles)
    .set({
      track: parsed.data.track,
      teachableSubjects: subjects,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/tutor/me");
  revalidatePath("/tutor");
  return { ok: true };
}
