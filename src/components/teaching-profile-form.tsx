"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import { SUBJECT_GROUPS, TRACKS, type TrackKey } from "@/lib/tutor-subjects";
import { cn } from "@/lib/utils";
import { saveMyTeachingProfile } from "@/app/tutor/me/actions";
import { saveTutorTeachingProfile } from "@/app/admin/tutors/actions";

/**
 * #348: 文理と担当できる科目をタップで選ぶ。
 * #349: profileId を渡すと教室長がその講師の分を保存する (渡さなければ本人の分)。
 */
export function TeachingProfileForm({
  initialTrack,
  initialSubjects,
  profileId,
}: {
  initialTrack: TrackKey | null;
  initialSubjects: string[];
  profileId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [track, setTrack] = useState<TrackKey | null>(initialTrack);
  const [subjects, setSubjects] = useState<Set<string>>(
    () => new Set(initialSubjects),
  );
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  function toggle(key: string) {
    setNotice(null);
    setSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    setNotice(null);
    startTransition(async () => {
      const input = { track, subjects: [...subjects] };
      const res = await (
        profileId
          ? saveTutorTeachingProfile({ ...input, profileId })
          : saveMyTeachingProfile(input)
      ).catch(toFailedResult);
      if (res.ok) {
        setNotice({ type: "ok", text: "保存しました。" });
        router.refresh();
      } else {
        setNotice({ type: "error", text: res.error ?? "保存できませんでした。" });
        if (isIndeterminate(res)) router.refresh();
      }
    });
  }

  // 中学生 / 高校生 の見出しごとにまとめる (高校生は小見出しの公共・地歴を含む)
  const levels = [...new Set(SUBJECT_GROUPS.map((g) => g.level))];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">理系・文系</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {TRACKS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={track === t.key}
                onClick={() => {
                  setNotice(null);
                  setTrack(t.key);
                }}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                  track === t.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">担当できる科目</CardTitle>
          <CardDescription>
            {profileId
              ? "教えられる科目をすべてタップしてください。講師本人のマイページにも同じ内容が出ます。"
              : "教えられる科目をすべてタップしてください。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {levels.map((level) => (
            <section key={level} className="space-y-2">
              <h3 className="text-sm font-semibold">{level}</h3>
              {SUBJECT_GROUPS.filter((g) => g.level === level).map((g) => (
                <div key={`${level}-${g.sub ?? ""}`} className="space-y-1.5">
                  {g.sub && (
                    <p className="text-xs text-muted-foreground">{g.sub}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {g.subjects.map((s) => {
                      const on = subjects.has(s.key);
                      return (
                        <button
                          key={s.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(s.key)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-colors",
                            on
                              ? "border-primary bg-primary font-medium text-primary-foreground"
                              : "bg-background text-foreground hover:bg-muted",
                          )}
                        >
                          {on && <Check className="size-3.5" />}
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </CardContent>
      </Card>

      {notice && (
        <p
          role={notice.type === "error" ? "alert" : "status"}
          className={cn(
            "text-sm",
            notice.type === "error" ? "text-destructive" : "text-green-700",
          )}
        >
          {notice.text}
        </p>
      )}
      <Button className="w-full" onClick={save} disabled={isPending}>
        {isPending ? "保存中..." : "保存する"}
      </Button>
    </div>
  );
}
