import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { findTopic, getGuide } from "@/lib/guide";
import { sanitizePagePath } from "@/lib/inquiry";
import { GuideTopicPage } from "@/components/guide/guide-topic-page";

export default async function TutorGuideTopicRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  await requireRole("tutor");
  const [{ slug }, { from }] = await Promise.all([params, searchParams]);
  const guide = getGuide("tutor");
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
