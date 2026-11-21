"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import {
  deleteMonthlySchedule,
  saveMonthlySchedule,
} from "@/lib/monthly-schedule-db";
import {
  looksLikePdf,
  MAX_SCHEDULE_PDF_BYTES,
  monthLabel,
  monthStartOf,
  TUTOR_SCHEDULES_PATH,
} from "@/lib/monthly-schedule";

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/admin/announcements");
  revalidatePath(TUTOR_SCHEDULES_PATH);
  revalidatePath("/tutor");
}

/** 室長レビュー要望12: 教室長が月のスケジュール PDF を上げる (同じ月は置き換え) */
export async function uploadMonthlySchedule(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");
  const month = monthStartOf(String(formData.get("month") ?? ""));
  if (!month) return { ok: false, error: "月を選んでください。" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "PDF を選んでください。" };
  }
  if (file.size > MAX_SCHEDULE_PDF_BYTES) {
    return { ok: false, error: "PDF が大きすぎます（4MB まで）。" };
  }
  const content = Buffer.from(await file.arrayBuffer());
  if (!looksLikePdf(content.subarray(0, 5))) {
    return { ok: false, error: "PDF ファイルを選んでください。" };
  }
  try {
    const { replaced, notified } = await saveMonthlySchedule(profile.id, {
      month,
      fileName: file.name.slice(0, 200) || "schedule.pdf",
      content,
    });
    revalidateAll();
    return {
      ok: true,
      message: `${monthLabel(month)}のスケジュールを${replaced ? "置き換え" : "登録し"}ました。講師 ${notified} 人に通知しました。`,
    };
  } catch (e) {
    console.error("uploadMonthlySchedule failed", e);
    return {
      ok: false,
      error: "保存できませんでした。時間をおいてもう一度お試しください。",
    };
  }
}

/** 教室長: 上げたスケジュールを消す (講師の画面から見えなくなる。通知は消さない) */
export async function removeMonthlySchedule(
  input: unknown,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = z
    .object({ month: z.string().regex(/^\d{4}-\d{2}-01$/) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  try {
    await deleteMonthlySchedule(parsed.data.month);
    revalidateAll();
    return { ok: true, message: `${monthLabel(parsed.data.month)}のスケジュールを消しました。` };
  } catch (e) {
    console.error("removeMonthlySchedule failed", e);
    return { ok: false, error: "消せませんでした。" };
  }
}
