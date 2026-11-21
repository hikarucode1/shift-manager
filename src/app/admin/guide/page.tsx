import { requireRole } from "@/lib/auth";
import { getGuide } from "@/lib/guide";
import { sanitizePagePath } from "@/lib/inquiry";
import { GuideIndex } from "@/components/guide/guide-index";

/** アプリ内の操作マニュアル (2026/11/21 本人依頼)。教室長用 */
export default async function AdminGuidePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  await requireRole("admin");
  const { from } = await searchParams;
  return (
    <GuideIndex
      guide={getGuide("admin")}
      from={sanitizePagePath(typeof from === "string" ? from : null)}
    />
  );
}
