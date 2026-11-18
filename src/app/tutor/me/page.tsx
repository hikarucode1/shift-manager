import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { TRACKS, normalizeSubjects, type TrackKey } from "@/lib/tutor-subjects";
import { TeachingProfileForm } from "@/components/teaching-profile-form";

/** #348: 講師のマイページ。文理と担当できる科目を自分で登録する */
export default async function TutorMyPage() {
  const { profile } = await requireRole("tutor");
  const [row] = await db
    .select({
      track: profiles.track,
      teachableSubjects: profiles.teachableSubjects,
    })
    .from(profiles)
    .where(eq(profiles.id, profile.id))
    .limit(1);
  const track = TRACKS.some((t) => t.key === row?.track)
    ? (row!.track as TrackKey)
    : null;

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <p className="text-xs text-primary-foreground/70">{profile.email}</p>
        <h1 className="mt-0.5 text-xl font-bold">マイページ</h1>
        <p className="mt-1 text-xs text-primary-foreground/80">
          {profile.displayName} さんの情報です。教室長がシフトを組むときの参考にします。
        </p>
      </section>
      <TeachingProfileForm
        initialTrack={track}
        initialSubjects={normalizeSubjects(row?.teachableSubjects ?? [])}
      />
    </div>
  );
}
