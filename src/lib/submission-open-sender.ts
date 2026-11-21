import "server-only";
import { and, arrayContains, eq, gt, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  notifications,
  periods,
  profiles,
  regularShiftPeriods,
} from "@/db/schema";
import { insertNotifications } from "@/lib/notifications";
import {
  courseOpenNotice,
  isRegularOpenDue,
  regularOpenNotice,
} from "@/lib/submission-open-notice";

/**
 * 室長レビュー要望4 (2026/11/21): シフト提出の受付が始まったら有効な講師
 * 全員に知らせる (ベル + プッシュ)。
 *
 * - 講習: 期間を作った時点で受付が始まるので、createPeriod から呼ぶ
 * - レギュラー: 受付開始日時 (submission_opens_at) になったら、5 分ごとの
 *   cron (/api/cron/shift-reminders) から `sendDueRegularOpenNotices` で送る
 *
 * どちらも dedupKey で期ごとに 1 回だけ。
 */

async function activeTutorIds(): Promise<string[]> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(eq(profiles.isActive, true), arrayContains(profiles.roles, ["tutor"])),
    );
  return rows.map((r) => r.id);
}

/** 講習期間を作ったときに呼ぶ。送った件数を返す (失敗時は throw) */
export async function notifyCourseSubmissionOpened(
  periodId: string,
): Promise<number> {
  const [p] = await db
    .select({
      id: periods.id,
      name: periods.name,
      submissionDeadline: periods.submissionDeadline,
    })
    .from(periods)
    .where(eq(periods.id, periodId))
    .limit(1);
  if (!p) return 0;
  return insertNotifications(await activeTutorIds(), {
    type: "submission_opened",
    ...courseOpenNotice(p),
  });
}

export type RegularOpenRunResult = { periods: number; sent: number };

/** cron から呼ぶ。受付開始日時を迎えたレギュラーの期を知らせる */
export async function sendDueRegularOpenNotices(
  now: Date = new Date(),
): Promise<RegularOpenRunResult> {
  const candidates = await db
    .select({
      id: regularShiftPeriods.id,
      label: regularShiftPeriods.label,
      submissionOpensAt: regularShiftPeriods.submissionOpensAt,
      submissionDueAt: regularShiftPeriods.submissionDueAt,
      createdAt: regularShiftPeriods.createdAt,
    })
    .from(regularShiftPeriods)
    .where(
      and(
        eq(regularShiftPeriods.isArchived, false),
        lte(regularShiftPeriods.submissionOpensAt, now),
        gt(regularShiftPeriods.submissionDueAt, now),
      ),
    );
  const due = candidates.filter((p) => isRegularOpenDue(p, now));
  if (due.length === 0) return { periods: 0, sent: 0 };

  // 既に送った期は飛ばす (5 分ごとに全講師へ insert を試みないため)。
  // 送った後に入った講師には届かないが、それで良い (受付中の期は画面に出る)
  const notices = due.map((p) => regularOpenNotice(p));
  const sentRows = await db
    .selectDistinct({ key: notifications.dedupKey })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "submission_opened"),
        inArray(
          notifications.dedupKey,
          notices.map((n) => n.dedupKey),
        ),
      ),
    );
  const already = new Set(sentRows.map((r) => r.key));
  const pending = notices.filter((n) => !already.has(n.dedupKey));
  if (pending.length === 0) return { periods: 0, sent: 0 };

  const tutors = await activeTutorIds();
  let sent = 0;
  for (const n of pending) {
    sent += await insertNotifications(tutors, {
      type: "submission_opened",
      ...n,
    });
  }
  return { periods: pending.length, sent };
}
