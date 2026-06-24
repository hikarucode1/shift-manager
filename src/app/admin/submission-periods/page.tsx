import { asc, desc } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { monthlySubmissionPeriods } from "@/db/schema";
import { AdminPeriodsNav } from "@/components/admin-section-nav";
import { SubmissionPeriodManager } from "./submission-period-manager";

export default async function AdminSubmissionPeriodsPage() {
  await requireRole("admin");

  const rows = await db
    .select({
      id: monthlySubmissionPeriods.id,
      targetMonth: monthlySubmissionPeriods.targetMonth,
      submissionOpensAt: monthlySubmissionPeriods.submissionOpensAt,
      submissionDueAt: monthlySubmissionPeriods.submissionDueAt,
      isArchived: monthlySubmissionPeriods.isArchived,
    })
    .from(monthlySubmissionPeriods)
    .orderBy(asc(monthlySubmissionPeriods.isArchived), desc(monthlySubmissionPeriods.targetMonth));

  const periodRows = rows.map((p) => ({
    id: p.id,
    targetMonth: p.targetMonth,
    submissionOpensAt: p.submissionOpensAt.toISOString(),
    submissionDueAt: p.submissionDueAt.toISOString(),
    isArchived: p.isArchived,
  }));

  return (
    <div className="space-y-6">
      <AdminPeriodsNav />
      <div>
        <h1 className="text-2xl font-semibold">月別提出期間管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講師がレギュラーシフトを提出できる期間を月単位で設定します。締切後の動作 (凍結 / 再開放) は別途実装予定です。削除はできません (アーカイブのみ)。
        </p>
      </div>
      <SubmissionPeriodManager periods={periodRows} now={new Date().toISOString()} />
    </div>
  );
}
