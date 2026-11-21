import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { findTopic, getGuide } from "@/lib/guide";
import { sanitizePagePath } from "@/lib/inquiry";
import { GuideTopicPage } from "@/components/guide/guide-topic-page";

export default async function AdminGuideTopicRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  await requireRole("admin");
  const [{ slug }, { from }] = await Promise.all([params, searchParams]);
  const guide = getGuide("admin");
  const topic = findTopic(guide, slug);
  if (!topic) notFound();
  return (
    <GuideTopicPage
      guide={guide}
      topic={topic}
      from={sanitizePagePath(typeof from === "string" ? from : null)}
    />
  );
}
