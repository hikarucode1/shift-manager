"use client";

import {
  SUBJECT_GROUPS,
  TRACKS,
  type SubjectFilter,
  type TrackKey,
} from "@/lib/tutor-subjects";
import { cn } from "@/lib/utils";

const TRACK_CHIPS: { key: TrackKey | "none" | null; label: string }[] = [
  { key: null, label: "すべて" },
  ...TRACKS.map((t) => ({ key: t.key, label: t.label })),
  { key: "none", label: "未登録" },
];

/** 文理ごとの色 (担当科目の表のバッジ・名前の横の印で共通) */
export const TRACK_BADGE_CLASS: Record<TrackKey, string> = {
  science: "bg-sky-100 text-sky-800",
  humanities: "bg-rose-100 text-rose-800",
  both: "bg-violet-100 text-violet-800",
};
const TRACK_DOT_CLASS: Record<TrackKey, string> = {
  science: "bg-sky-500",
  humanities: "bg-rose-500",
  both: "bg-violet-500",
};

/** #350: 名前の前に付ける文理の小さな丸。未登録なら何も出さない */
export function TrackDot({ track }: { track: string | null }) {
  const label = TRACKS.find((t) => t.key === track)?.label;
  if (!label) return null;
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        TRACK_DOT_CLASS[track as TrackKey],
      )}
    />
  );
}

/**
 * #349 / #350: 文理のチップと科目の選択。値は呼ぶ側が持つ
 * (担当科目の表は URL、シフト希望の画面は画面の中の状態)。
 */
export function SubjectFilterBar({
  value,
  onChange,
  children,
  className,
}: {
  value: SubjectFilter;
  onChange: (next: SubjectFilter) => void;
  /** 右端に置くもの (印刷ボタンなど) */
  children?: React.ReactNode;
  className?: string;
}) {
  const levels = [...new Set(SUBJECT_GROUPS.map((g) => g.level))];
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}
    >
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="文理">
        {TRACK_CHIPS.map((c) => (
          <button
            key={c.key ?? "all"}
            type="button"
            aria-pressed={value.track === c.key}
            onClick={() => onChange({ ...value, track: c.key })}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              value.track === c.key
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
          value={value.subject ?? ""}
          onChange={(e) =>
            onChange({ ...value, subject: e.target.value || null })
          }
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">すべて</option>
          {levels.map((level) => (
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
      {children}
    </div>
  );
}

/**
 * 室長レビュー要望6: 講師 1 人に絞る選択。文理・科目の絞り込みと一緒に使う
 * (SubjectFilterBar の children に置く)。null は「全員」
 */
export function TutorFilterSelect({
  tutors,
  value,
  onChange,
}: {
  tutors: { id: string; name: string }[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">講師</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        <option value="">全員</option>
        {tutors.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
