import Link from "next/link";
import { and, arrayContains, asc, eq } from "drizzle-orm";
import { Check } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { AdminTutorsNav } from "@/components/admin-section-nav";
import { cn } from "@/lib/utils";
import {
  ALL_SUBJECT_KEYS,
  SUBJECT_GROUPS,
  TRACKS,
  matchesTrackFilter,
  subjectShortLabel,
  trackLabel,
  type TrackKey,
} from "@/lib/tutor-subjects";
import { SubjectFilter } from "./subject-filter";

const TRACK_STYLE: Record<TrackKey, string> = {
  science: "bg-sky-100 text-sky-800",
  humanities: "bg-rose-100 text-rose-800",
  both: "bg-violet-100 text-violet-800",
};

/** 列の並び (中学生 5 + 高校生 16)。高校生は公共・地歴も続けて並べる */
const COLUMNS = SUBJECT_GROUPS.flatMap((g) =>
  g.subjects.map((s) => ({ ...s, level: g.level })),
);
const LEVELS = [...new Set(COLUMNS.map((c) => c.level))].map((level) => ({
  level,
  span: COLUMNS.filter((c) => c.level === level).length,
}));

/**
 * #349: 講師 × 担当できる科目の表。シフトを組むときに「数IA ができる人」を
 * 探す用。無効にした講師は出さない。ブラウザの印刷でそのまま紙にできる。
 */
export default async function AdminTutorSubjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ track?: string; subject?: string }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;
  const trackFilter =
    sp.track === "none" || TRACKS.some((t) => t.key === sp.track)
      ? (sp.track as TrackKey | "none")
      : null;
  const subjectFilter =
    sp.subject && ALL_SUBJECT_KEYS.includes(sp.subject) ? sp.subject : null;

  const tutors = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      track: profiles.track,
      teachableSubjects: profiles.teachableSubjects,
    })
    .from(profiles)
    .where(
      and(arrayContains(profiles.roles, ["tutor"]), eq(profiles.isActive, true)),
    )
    .orderBy(asc(profiles.displayName));

  const rows = tutors.filter(
    (t) =>
      matchesTrackFilter(t.track, trackFilter) &&
      (!subjectFilter || t.teachableSubjects.includes(subjectFilter)),
  );
  const unregistered = tutors.filter(
    (t) => !trackLabel(t.track) || t.teachableSubjects.length === 0,
  ).length;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <AdminTutorsNav />
      </div>
      <div>
        <h1 className="text-2xl font-semibold">担当科目</h1>
        <p className="mt-1 text-sm text-muted-foreground print:hidden">
          講師が担当できる科目の一覧です。名前を押すとその講師の登録を直せます。
          {unregistered > 0 && `まだ登録していない講師が ${unregistered} 人います。`}
        </p>
      </div>

      <SubjectFilter track={trackFilter ?? ""} subject={subjectFilter ?? ""} />

      <p className="text-sm text-muted-foreground">
        {trackFilter || subjectFilter
          ? `${tutors.length} 人中 ${rows.length} 人`
          : `${tutors.length} 人`}
        {subjectFilter && `（${subjectShortLabel(subjectFilter)} ができる人）`}
        {trackFilter && trackFilter !== "none" && trackFilter !== "both" && (
          <span className="print:hidden">・「どちらも」の人も含みます</span>
        )}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          当てはまる講師はいません。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border print:overflow-visible">
          <table className="w-full border-collapse text-sm print:text-[10px]">
            <thead className="bg-muted/60">
              <tr>
                <th
                  rowSpan={2}
                  className="sticky left-0 z-10 min-w-28 border-b bg-muted px-3 py-2 text-left font-semibold"
                >
                  講師
                </th>
                <th
                  rowSpan={2}
                  className="border-b border-l px-2 py-2 font-semibold"
                >
                  文理
                </th>
                {LEVELS.map((l) => (
                  <th
                    key={l.level}
                    colSpan={l.span}
                    className="border-b border-l px-2 py-1 text-xs font-semibold"
                  >
                    {l.level}
                  </th>
                ))}
              </tr>
              <tr>
                {COLUMNS.map((c, i) => (
                  <th
                    key={c.key}
                    className={cn(
                      "border-b px-1.5 py-1.5 text-xs font-medium whitespace-nowrap",
                      (i === 0 || COLUMNS[i - 1].level !== c.level) && "border-l",
                      c.key === subjectFilter &&
                        "bg-primary text-primary-foreground",
                    )}
                  >
                    {c.label === "統計（数B）" ? "統計" : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const tl = trackLabel(t.track);
                const has = new Set(t.teachableSubjects);
                return (
                  <tr key={t.id} className="border-b last:border-b-0">
                    <td className="sticky left-0 z-10 bg-background px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/admin/tutors/${t.id}`}
                        className="font-medium underline-offset-4 hover:text-primary hover:underline"
                      >
                        {t.displayName}
                      </Link>
                    </td>
                    <td className="border-l px-2 py-2 text-center">
                      {tl ? (
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap",
                            TRACK_STYLE[t.track as TrackKey],
                          )}
                        >
                          {tl}
                        </span>
                      ) : (
                        <span className="text-xs whitespace-nowrap text-muted-foreground">
                          未登録
                        </span>
                      )}
                    </td>
                    {COLUMNS.map((c, i) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-1.5 py-2 text-center",
                          (i === 0 || COLUMNS[i - 1].level !== c.level) &&
                            "border-l",
                          c.key === subjectFilter && "bg-primary/10",
                        )}
                      >
                        {has.has(c.key) && (
                          <Check
                            className="mx-auto size-4 text-primary"
                            aria-label="できる"
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
