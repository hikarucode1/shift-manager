import { and, arrayContains, count, eq, isNotNull, ne } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { getAdminAnnouncements } from "@/lib/announcements-db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnnouncementForm } from "./announcement-form";
import { AnnouncementList } from "./announcement-list";
import { MonthlyScheduleCard } from "./monthly-schedule-card";
import { listMonthlySchedules } from "@/lib/monthly-schedule-db";
import { nextMonthOf } from "@/lib/monthly-schedule";
import { jstMonthStart } from "@/lib/week";

/**
 * 教室長: 講師全員へのお知らせ。今まで LINE でシフトと一緒に送っていた連絡を
 * 好きなときに出し、誰が確認したか (LINE のスタンプの代わり) を見る
 */
export default async function AdminAnnouncementsPage() {
  const { profile } = await requireRole("admin");
  const [items, [tutors], schedules] = await Promise.all([
    getAdminAnnouncements(),
    // 送る前の確認に出す人数 (createAnnouncement の宛先と同じ条件)
    db
      .select({ value: count() })
      .from(profiles)
      .where(
        and(
          arrayContains(profiles.roles, ["tutor"]),
          eq(profiles.isActive, true),
          isNotNull(profiles.authUserId),
          ne(profiles.id, profile.id),
        ),
      ),
    // 室長レビュー要望12: 月のスケジュール PDF (新しい月から)
    listMonthlySchedules(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">お知らせ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講師全員のベルとスマホに届きます。講師が「確認しました」を押すと、下の一覧で分かります。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">新しいお知らせ</CardTitle>
        </CardHeader>
        <CardContent>
          <AnnouncementForm tutorCount={tutors?.value ?? 0} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">月のスケジュール（PDF）</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyScheduleCard
            rows={schedules.map((r) => ({
              month: r.month,
              fileName: r.fileName,
              updatedAt: r.updatedAt.toISOString(),
            }))}
            defaultMonth={nextMonthOf(jstMonthStart())}
          />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">送ったお知らせ</h2>
        <AnnouncementList
          items={items.map((a) => ({
            ...a,
            createdAt: a.createdAt.toISOString(),
          }))}
        />
      </section>
    </div>
  );
}
