import { asc, desc } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { periods } from "@/db/schema";
import { jstToday } from "@/lib/week";
import { PeriodManager } from "./period-manager";

export default async function AdminPeriodsPage() {
  await requireRole("admin");

  const rows = await db
    .select({
      id: periods.id,
      name: periods.name,
      startDate: periods.startDate,
      endDate: periods.endDate,
      submissionDeadline: periods.submissionDeadline,
      isReopened: periods.isReopened,
      isArchived: periods.isArchived,
    })
    .from(periods)
    .orderBy(asc(periods.isArchived), desc(periods.startDate));

  const periodRows = rows.map((p) => ({
    id: p.id,
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate,
    submissionDeadline: p.submissionDeadline
      ? p.submissionDeadline.toISOString()
      : null,
    isReopened: p.isReopened,
    isArchived: p.isArchived,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">講習期間管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講習期間と、講習の希望提出締切日を設定します。削除はできません（アーカイブのみ）。
          講師のレギュラーシフト提出期は「レギュラー期間」で設定します。
        </p>
      </div>
      <PeriodManager periods={periodRows} today={jstToday()} />
    </div>
  );
}
