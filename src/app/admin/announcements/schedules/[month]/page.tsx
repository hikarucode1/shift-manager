import { requireRole } from "@/lib/auth";
import { ADMIN_SCHEDULES_PATH } from "@/lib/monthly-schedule";
import { SchedulePdfPage } from "@/components/schedule-pdf-page";

/** 教室長が、上げた月のスケジュール (PDF) をアプリの画面の中で確かめる */
export default async function AdminSchedulePdfRoute({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  await requireRole("admin");
  const { month } = await params;
  return (
    <SchedulePdfPage
      ym={month}
      back={{ href: ADMIN_SCHEDULES_PATH, label: "お知らせ" }}
    />
  );
}
