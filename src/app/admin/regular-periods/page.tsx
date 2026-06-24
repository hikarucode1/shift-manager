import { asc, desc } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { regularShiftPeriods } from "@/db/schema";
import { AdminPeriodsNav } from "@/components/admin-section-nav";
import { RegularPeriodManager } from "./regular-period-manager";

export default async function AdminRegularPeriodsPage() {
  await requireRole("admin");

  const rows = await db
    .select({
      id: regularShiftPeriods.id,
      label: regularShiftPeriods.label,
      startDate: regularShiftPeriods.startDate,
      endDate: regularShiftPeriods.endDate,
      submissionOpensAt: regularShiftPeriods.submissionOpensAt,
      submissionDueAt: regularShiftPeriods.submissionDueAt,
      isArchived: regularShiftPeriods.isArchived,
    })
    .from(regularShiftPeriods)
    .orderBy(
      asc(regularShiftPeriods.isArchived),
      desc(regularShiftPeriods.startDate),
    );

  const periodRows = rows.map((p) => ({
    id: p.id,
    label: p.label,
    startDate: p.startDate,
    endDate: p.endDate,
    submissionOpensAt: p.submissionOpensAt.toISOString(),
    submissionDueAt: p.submissionDueAt.toISOString(),
    isArchived: p.isArchived,
  }));

  return (
    <div className="space-y-6">
      <AdminPeriodsNav />
      <div>
        <h1 className="text-2xl font-semibold">レギュラー期間管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講師がレギュラーシフトを提出する「期」(可変長) を設定します。期は通常 3
          ヶ月程度で、期内のレギュラーシフトを 1 回の提出 → 確定で運用します。
          削除はできません (アーカイブのみ)。
        </p>
      </div>
      <RegularPeriodManager
        periods={periodRows}
        now={new Date().toISOString()}
      />
    </div>
  );
}
