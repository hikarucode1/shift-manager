import { and, arrayContains, eq, isNull, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { getAdminWeekSchedule } from "@/lib/admin-schedule";
import { getPendingAbsenceRequests } from "@/lib/absences";
import { getPendingSwapRequests } from "@/lib/swaps";
import { getHeatmapData, getHeatmapPeriods } from "@/lib/training-overview";
import { weekOf } from "@/lib/week";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { RequestsPanel } from "./requests/requests-panel";
import { SwapRequestsPanel } from "./requests/swap-requests-panel";

/** tutor ロールかつ auth 未連携・有効な講師の人数 (招待が必要な人数) */
async function countUnlinkedTutors(): Promise<number> {
  const row = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(profiles)
    .where(
      and(
        arrayContains(profiles.roles, ["tutor"]),
        isNull(profiles.authUserId),
        eq(profiles.isActive, true),
      ),
    );
  return row[0]?.c ?? 0;
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-l-[3px] border-l-accent">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-[28px] font-bold leading-none text-accent">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function AdminHome() {
  await requireRole("admin");

  const week = weekOf();
  const periods = await getHeatmapPeriods();
  const currentPeriod = periods[0] ?? null;

  const [schedule, pendingAbsences, pendingSwaps, unlinkedCount, heatmap] =
    await Promise.all([
      getAdminWeekSchedule(week),
      getPendingAbsenceRequests(),
      getPendingSwapRequests(),
      countUnlinkedTutors(),
      currentPeriod ? getHeatmapData(currentPeriod.id) : Promise.resolve(null),
    ]);

  const pendingTotal = pendingAbsences.length + pendingSwaps.length;
  const total = schedule.totalShiftCount;
  const absent = schedule.absentShiftCount;
  const working = total - absent;
  const fulfillPct = total > 0 ? Math.round((working / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">ダッシュボード</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          今週の稼働状況・未対応の申請をひと目で確認できます。
        </p>
      </div>

      {/* 上段: KPI 4 列 */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="今週の確定コマ" value={`${total}`} />
        <KpiCard label="未承認の申請" value={`${pendingTotal}`} />
        <KpiCard
          label="講習希望 提出"
          value={
            heatmap
              ? `${heatmap.submittedTutorCount} / ${heatmap.totalTutorCount}`
              : "—"
          }
        />
        <KpiCard label="未連携の講師" value={`${unlinkedCount}`} />
      </div>

      {/* 下段: 左=承認待ち / 右=今週の充足状況 */}
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <h2 className="text-base font-semibold">承認待ちの申請</h2>
          {pendingTotal === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                未対応の申請はありません。
              </CardContent>
            </Card>
          ) : (
            <>
              {pendingSwaps.length > 0 && (
                <SwapRequestsPanel pending={pendingSwaps} />
              )}
              {pendingAbsences.length > 0 && (
                <RequestsPanel pending={pendingAbsences} />
              )}
            </>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="text-base font-semibold">今週の充足状況</h2>
          <Card>
            <CardContent className="space-y-4 p-4">
              {schedule.published ? (
                <>
                  <div>
                    <p className="text-[32px] font-bold leading-none text-accent">
                      {fulfillPct}%
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      確定コマのうち実働見込みの割合
                    </p>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={fulfillPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${fulfillPct}%` }}
                    />
                  </div>
                  <dl className="space-y-1.5 text-sm">
                    <Detail label="確定コマ" value={`${total} コマ`} />
                    <Detail
                      label="承認済み欠勤"
                      value={`${absent} コマ`}
                      emphasize={absent > 0}
                    />
                    <Detail label="実働見込み" value={`${working} コマ`} />
                  </dl>
                </>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  今週のシフトはまだ公開されていません。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", emphasize && "text-destructive")}>
        {value}
      </dd>
    </div>
  );
}
