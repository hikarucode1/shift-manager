"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { dayOffRequests } from "@/db/schema";
import { firstDayOffDate, isDatePublished } from "@/lib/day-offs";
import { dayOffSlotsLabel, normalizeSlotNumbers } from "@/lib/day-off-rule";
import { notifyAdmins } from "@/lib/notifications";
import { getSlotMeta } from "@/lib/slot-meta";
import { listLabel } from "@/lib/submission-notice";
import { isValidIsoDate, jstToday, noticeDate } from "@/lib/week";

/**
 * #360: 先の日の休み希望 (講師側)。シフトがまだ公開されていない日に出す。
 * 公開済みの週は欠勤申請で扱う。
 */

type ActionResult = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/tutor/day-offs");
  revalidatePath("/admin/requests");
}

const CreateInput = z.object({
  /** 室長レビュー要望1: 複数の日をまとめて出せる (コマ・理由は共通) */
  dates: z
    .array(z.string().refine(isValidIsoDate, "日付が不正です。"))
    .min(1, "日付を選んでください。")
    .max(31, "一度に出せるのは 31 日までです。"),
  /** 空なら終日 */
  slotNumbers: z.array(z.number().int().min(1).max(20)).max(20),
  reason: z.string().trim().min(1, "理由を入力してください。").max(500),
});

export async function createDayOffRequest(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { reason } = parsed.data;
  const dates = [...new Set(parsed.data.dates)].sort();
  const multiple = dates.length > 1;
  const slotNumbers = normalizeSlotNumbers(parsed.data.slotNumbers);

  const today = jstToday();
  const first = await firstDayOffDate(today);
  for (const date of dates) {
    if (date < first || (await isDatePublished(date))) {
      return {
        ok: false,
        error: `${multiple ? `${noticeDate(date)}: ` : ""}この日はもうシフトが出ています。出勤するコマがあれば「欠勤申請」から申請してください。`,
      };
    }
  }
  const meta = await getSlotMeta();
  if (slotNumbers.some((n) => !meta.has(n))) {
    return { ok: false, error: "存在しないコマが含まれています。" };
  }

  const [dup] = await db
    .select({ date: dayOffRequests.date })
    .from(dayOffRequests)
    .where(
      and(
        eq(dayOffRequests.tutorId, profile.id),
        inArray(dayOffRequests.date, dates),
        inArray(dayOffRequests.status, ["pending", "approved"]),
      ),
    )
    .orderBy(asc(dayOffRequests.date))
    .limit(1);
  if (dup) {
    return {
      ok: false,
      error: `${multiple ? `${noticeDate(dup.date)}: ` : ""}この日の休み希望はもう出ています。変えるときは取り下げてから出し直してください。`,
    };
  }

  // 1 回の INSERT なので、全部入るか 1 つも入らないかのどちらか
  await db.insert(dayOffRequests).values(
    dates.map((date) => ({ tutorId: profile.id, date, slotNumbers, reason })),
  );

  const label = (n: number) => meta.get(n)?.label ?? `${n}限`;
  const short = reason.length > 60 ? `${reason.slice(0, 60)}…` : reason;
  // まとめて出したときも通知は 1 件にする
  await notifyAdmins(
    {
      type: "day_off_requested",
      title: multiple
        ? `${profile.displayName}さんから休み希望が ${dates.length} 日分届きました`
        : `${profile.displayName}さんから休み希望が届きました`,
      body: `${listLabel(dates.map(noticeDate))} ${dayOffSlotsLabel(slotNumbers, label)} ／ 理由: ${short}`,
      href: "/admin/requests",
    },
    { exceptProfileId: profile.id },
  );
  revalidate();
  return { ok: true };
}

/**
 * 取り下げ。承認待ちに加えて、承認済みでもまだ公開前の日なら取り下げられる
 * (出られるようになったとき)。承認済みを取り下げたら教室長に知らせる
 */
export async function cancelDayOffRequest(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const today = jstToday();
  const [row] = await db
    .select({
      date: dayOffRequests.date,
      status: dayOffRequests.status,
      slotNumbers: dayOffRequests.slotNumbers,
    })
    .from(dayOffRequests)
    .where(
      and(
        eq(dayOffRequests.id, parsed.data.id),
        eq(dayOffRequests.tutorId, profile.id),
        gte(dayOffRequests.date, today),
      ),
    )
    .limit(1);
  if (!row || (row.status !== "pending" && row.status !== "approved")) {
    return {
      ok: false,
      error: "取り下げられませんでした。画面を読み込み直してください。",
    };
  }
  if (row.status === "approved" && (await isDatePublished(row.date))) {
    return {
      ok: false,
      error: "この日はもうシフトが出ています。教室長に直接伝えてください。",
    };
  }

  const updated = await db
    .update(dayOffRequests)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(dayOffRequests.id, parsed.data.id),
        eq(dayOffRequests.status, row.status),
      ),
    )
    .returning({ id: dayOffRequests.id });
  if (updated.length === 0) {
    return {
      ok: false,
      error: "取り下げられませんでした。画面を読み込み直してください。",
    };
  }

  if (row.status === "approved") {
    const meta = await getSlotMeta().catch(() => new Map());
    const label = (n: number) => meta.get(n)?.label ?? `${n}限`;
    await notifyAdmins(
      {
        type: "day_off_requested",
        title: `${profile.displayName}さんが休み希望を取り下げました`,
        body: `${noticeDate(row.date)} ${dayOffSlotsLabel(row.slotNumbers, label)} ／ 承認済みの休みでしたが、出られるようになりました`,
        href: "/admin/requests",
      },
      { exceptProfileId: profile.id },
    );
  }
  revalidate();
  return { ok: true };
}
