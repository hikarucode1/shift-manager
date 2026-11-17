import "server-only";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { profiles, swapRequests } from "@/db/schema";
import { notifyAdmins } from "@/lib/notifications";
import { slotLabelSafe } from "@/lib/slot-meta";
import {
  overdueWindow,
  isDesignationOverdue,
} from "@/lib/designation-overdue-rule";
import { noticeDate } from "@/lib/week";

/**
 * #331 PR 3: 欠勤で指定した代講の相手から、前日になっても返事が無い依頼を
 * 教室長のベルに知らせる。
 *
 * 定期実行の仕組みは置かず、教室長のベルが未読数を取りに来たとき (60 秒ごと・
 * 画面に戻ったとき) に確かめる。通知はアプリ内だけなので、教室長が気づくのは
 * どのみちアプリを開いたとき。同じ依頼には 1 回だけ (dedupKey = 依頼の id)。
 *
 * 失敗しても throw しない (ベルの未読数の取得を巻き込まない)。
 */
export async function notifyOverdueDesignations(
  now = new Date(),
): Promise<void> {
  try {
    const { from, to } = overdueWindow(now);
    const requester = alias(profiles, "requester");
    const nominee = alias(profiles, "nominee");
    const rows = await db
      .select({
        id: swapRequests.id,
        date: swapRequests.date,
        slotNumber: swapRequests.slotNumber,
        createdAt: swapRequests.createdAt,
        requesterName: requester.displayName,
        nomineeName: nominee.displayName,
      })
      .from(swapRequests)
      .innerJoin(requester, eq(requester.id, swapRequests.requesterId))
      .innerJoin(nominee, eq(nominee.id, swapRequests.nominatedTutorId))
      .where(
        and(
          eq(swapRequests.status, "pending"),
          eq(swapRequests.kind, "named"),
          isNotNull(swapRequests.absenceRequestId),
          gte(swapRequests.date, from),
          lte(swapRequests.date, to),
        ),
      );

    for (const r of rows) {
      if (!isDesignationOverdue(r, now)) continue;
      const slotLabel = await slotLabelSafe(r.slotNumber);
      await notifyAdmins({
        type: "substitute_response",
        title: "指定した代講の返事がまだありません",
        body: `対象: ${noticeDate(r.date)} ${slotLabel} ／ ${r.requesterName}さんの代講を${r.nomineeName}さんに依頼中。指定し直すか、代講の募集に出してください`,
        href: "/admin/requests",
        // 引き受け / 断る の通知 (dedupKey なし) とは別に、1 回だけ
        dedupKey: `noreply:${r.id}`,
      });
    }
  } catch (e) {
    console.error("notifyOverdueDesignations failed:", e);
  }
}
