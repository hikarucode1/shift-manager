import "server-only";
import { and, arrayContains, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { profiles, shiftUploads, weeklyShifts } from "@/db/schema";
import { getApprovedAbsenceKeysAll } from "@/lib/absences";
import { insertNotifications } from "@/lib/notifications";
import {
  firstSlotOfDay,
  isReminderDue,
  reminderMessage,
} from "@/lib/shift-reminder-rule";
import { getSlotMeta } from "@/lib/slot-meta";
import { addDays, jstToday } from "@/lib/week";

export type ShiftReminderRunResult = {
  /** 通知を入れた (送った) 講師の数 */
  sent: number;
  /** 通知をオンにしている有効な講師の数 */
  subscribers: number;
  failed: number;
};

/**
 * メモ15: 出勤の○時間前のリマインドを、今送るべき講師に送る。
 * /api/cron/shift-reminders から 5 分ごとに呼ばれる前提。
 *
 * - 対象は「通知をオンにしている有効な講師」の、今日と明日 (JST) の確定シフト
 *   (公開済みの座席表の分だけ。代講で引き受けたコマも weekly_shifts 上で
 *   本人のコマになっている)
 * - 承認済みの欠勤のコマは除く。その日の最初の (欠勤でない) コマが基準
 * - 同じ講師・同じ日には 1 回だけ (dedupKey = 日付)。何度呼ばれても二重に届かない
 */
export async function sendDueShiftReminders(
  now: Date = new Date(),
): Promise<ShiftReminderRunResult> {
  const subscribers = await db
    .select({ id: profiles.id, hours: profiles.shiftReminderHours })
    .from(profiles)
    .where(
      and(
        isNotNull(profiles.shiftReminderHours),
        eq(profiles.isActive, true),
        arrayContains(profiles.roles, ["tutor"]),
      ),
    );
  if (subscribers.length === 0) return { sent: 0, subscribers: 0, failed: 0 };

  const today = jstToday(now);
  const tomorrow = addDays(today, 1);
  const hoursById = new Map(subscribers.map((s) => [s.id, s.hours ?? 0]));

  const [slotMeta, absentKeys, rows] = await Promise.all([
    getSlotMeta(),
    getApprovedAbsenceKeysAll(today, tomorrow),
    db
      .select({
        tutorId: weeklyShifts.tutorId,
        date: weeklyShifts.date,
        slotNumber: weeklyShifts.slotNumber,
      })
      .from(weeklyShifts)
      .innerJoin(shiftUploads, eq(shiftUploads.id, weeklyShifts.uploadId))
      .where(
        and(
          inArray(weeklyShifts.tutorId, [...hoursById.keys()]),
          inArray(weeklyShifts.date, [today, tomorrow]),
          isNotNull(shiftUploads.publishedAt),
        ),
      ),
  ]);

  // (講師, 日付) ごとの欠勤でないコマ
  type Slot = { slotNumber: number; startTime: string; label: string };
  const byTutorDay = new Map<string, { tutorId: string; date: string; slots: Slot[] }>();
  for (const r of rows) {
    if (absentKeys.has(`${r.tutorId}|${r.date}|${r.slotNumber}`)) continue;
    const key = `${r.tutorId}|${r.date}`;
    let e = byTutorDay.get(key);
    if (!e) {
      e = { tutorId: r.tutorId, date: r.date, slots: [] };
      byTutorDay.set(key, e);
    }
    const meta = slotMeta.get(r.slotNumber);
    e.slots.push({
      slotNumber: r.slotNumber,
      startTime: meta?.start ?? "",
      label: meta?.label ?? `${r.slotNumber}限`,
    });
  }

  let sent = 0;
  let failed = 0;
  for (const { tutorId, date, slots } of byTutorDay.values()) {
    const first = firstSlotOfDay(slots);
    const hours = hoursById.get(tutorId) ?? 0;
    if (!first || !isReminderDue({ date, startTime: first.startTime, hours, now })) {
      continue;
    }
    const msg = reminderMessage({
      startTime: first.startTime,
      label: first.label,
      slotCount: slots.length,
    });
    try {
      sent += await insertNotifications([tutorId], {
        type: "shift_reminder",
        title: msg.title,
        body: msg.body,
        href: "/tutor",
        dedupKey: date,
      });
    } catch (e) {
      failed++;
      console.error("shift reminder failed:", tutorId, date, e);
    }
  }
  return { sent, subscribers: subscribers.length, failed };
}
