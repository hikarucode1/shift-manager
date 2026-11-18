"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUBJECT_GROUPS, TRACKS } from "@/lib/tutor-subjects";
import { cn } from "@/lib/utils";

const TRACK_CHIPS = [
  { key: "", label: "すべて" },
  ...TRACKS.map((t) => ({ key: t.key as string, label: t.label })),
  { key: "none", label: "未登録" },
];

/** #349: 担当科目の表の絞り込み (URL の ?track= / ?subject= に持つ) */
export function SubjectFilter({
  track,
  subject,
}: {
  track: string;
  subject: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function set(key: "track" | "subject", value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="文理">
        {TRACK_CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={track === c.key}
            onClick={() => set("track", c.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              track === c.key
                ? "border-primary bg-primary font-medium text-primary-foreground"
                : "bg-background hover:bg-muted",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">科目</span>
        <select
          value={subject}
          onChange={(e) => set("subject", e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">すべて</option>
          {[...new Set(SUBJECT_GROUPS.map((g) => g.level))].map((level) => (
            <optgroup key={level} label={level}>
              {SUBJECT_GROUPS.filter((g) => g.level === level).flatMap((g) =>
                g.subjects.map((s) => (
                  <option key={s.key} value={s.key}>
                    {level === "中学生" ? "中" : "高"}
                    {s.label}
                  </option>
                )),
              )}
            </optgroup>
          ))}
        </select>
      </label>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={() => window.print()}
      >
        <Printer />
        印刷
      </Button>
    </div>
  );
}
