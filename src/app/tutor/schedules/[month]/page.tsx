import { requireRole } from "@/lib/auth";
import { TUTOR_SCHEDULES_PATH } from "@/lib/monthly-schedule";
import { SchedulePdfPage } from "@/components/schedule-pdf-page";

/** 講師が月のスケジュール (PDF) をアプリの画面の中で見る */
export default async function TutorSchedulePdfRoute({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  await requireRole("tutor");
  const { month } = await params;
  return (
    <SchedulePdfPage
      ym={month}
      back={{ href: TUTOR_SCHEDULES_PATH, label: "月のスケジュール" }}
    />
  );
}
