import Link from "next/link";
import { notFound } from "next/navigation";
import { and, arrayContains, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { AdminTutorsNav } from "@/components/admin-section-nav";
import { TeachingProfileForm } from "@/components/teaching-profile-form";
import { Badge } from "@/components/ui/badge";
import { avatarColor, avatarInitial } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { TRACKS, normalizeSubjects, type TrackKey } from "@/lib/tutor-subjects";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** #349: 講師 1 人の詳細。文理・担当できる科目を見る / 代わりに登録する */
export default async function AdminTutorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [t] = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      email: profiles.email,
      isActive: profiles.isActive,
      authUserId: profiles.authUserId,
      track: profiles.track,
      teachableSubjects: profiles.teachableSubjects,
    })
    .from(profiles)
    .where(and(eq(profiles.id, id), arrayContains(profiles.roles, ["tutor"])))
    .limit(1);
  if (!t) notFound();

  const track = TRACKS.some((x) => x.key === t.track)
    ? (t.track as TrackKey)
    : null;
  const registered = track !== null && t.teachableSubjects.length > 0;

  return (
    <div className="space-y-6">
      <AdminTutorsNav />
      <div className="mx-auto max-w-xl space-y-5">
        <Link
          href="/admin/tutors"
          className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          講師の一覧へ
        </Link>

        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white",
              avatarColor(t.id),
            )}
            aria-hidden
          >
            {avatarInitial(t.displayName)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{t.displayName}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {/* 未連携の講師のメールは仮 (stub-…@example.invalid) なので出さない */}
              {t.authUserId !== null ? t.email : "ログイン未連携"}
            </p>
          </div>
          {!t.isActive && (
            <Badge variant="outline" className="ml-auto shrink-0">
              無効
            </Badge>
          )}
        </div>

        {!registered && (
          <p className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm">
            {t.authUserId === null
              ? "まだログインしていない講師です。分かる範囲で代わりに登録できます。"
              : "本人がまだ登録していません。分かる範囲で代わりに登録することもできます。"}
          </p>
        )}

        <TeachingProfileForm
          profileId={t.id}
          initialTrack={track}
          initialSubjects={normalizeSubjects(t.teachableSubjects)}
        />
      </div>
    </div>
  );
}
