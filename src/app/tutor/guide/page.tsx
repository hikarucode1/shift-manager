import { requireRole } from "@/lib/auth";
import { getGuide } from "@/lib/guide";
import { sanitizePagePath } from "@/lib/inquiry";
import { GuideIndex } from "@/components/guide/guide-index";

/** アプリ内の操作マニュアル (2026/11/21 本人依頼)。講師用 */
export default async function TutorGuidePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  await requireRole("tutor");
  const { from } = await searchParams;
  return (
    <GuideIndex
      guide={getGuide("tutor")}
      from={sanitizePagePath(typeof from === "string" ? from : null)}
    />
  );
}
