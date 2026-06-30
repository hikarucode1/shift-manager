"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import type { HeatmapData, HeatmapTutor } from "@/lib/training-overview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { saveCourseConfirmations } from "./confirm-actions";

/**
 * 希望者数 → 5 段階のヒートレベル (0 = 無色, 1..4 = 薄→濃)。
 * デザイン (screen 6) の橙ランプ #fde8d8→#f9c89e→#f0a060→#e9803a を accent
 * トークンのアルファで近似する。max に対する相対割合で段階化 (実データ依存)。
 */
function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const frac = count / max;
  if (frac <= 0.25) return 1;
  if (frac <= 0.5) return 2;
  if (frac <= 0.75) return 3;
  return 4;
}

/** ヒートレベル → accent アルファ。index 0 は無色 (· 表示)。 */
const HEAT_ALPHA = [0, 0.15, 0.38, 0.62, 0.9] as const;

type OpenCell = {
  date: string;
  slotNumber: number;
  slotLabel: string;
  tutors: HeatmapTutor[];
  initialConfirmedIds: string[];
};

export function TrainingHeatmap({ data }: { data: HeatmapData }) {
  const router = useRouter();
  const {
    period,
    slots,
    days,
    counts,
    tutorsByCell,
    confirmedByCell,
    orphanTutors,
    maxCount,
  } = data;

  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<OpenCell | null>(null);
  // モーダル内: 編集中の確定講師 ID セット
  const [editedConfirmedIds, setEditedConfirmedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function openCell(date: string, slotNumber: number, slotLabel: string) {
    const key = `${date}|${slotNumber}`;
    const cellTutors = tutorsByCell[key] ?? [];
    const confirmedIds = confirmedByCell[key] ?? [];
    setOpen({
      date,
      slotNumber,
      slotLabel,
      tutors: cellTutors,
      initialConfirmedIds: confirmedIds,
    });
    setEditedConfirmedIds(new Set(confirmedIds));
  }

  function toggleTutor(tutorId: string) {
    setEditedConfirmedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tutorId)) next.delete(tutorId);
      else next.add(tutorId);
      return next;
    });
  }

  function handleSave() {
    if (!open) return;
    setNotice(null);
    const tutorIds = Array.from(editedConfirmedIds);
    startTransition(async () => {
      const result = await saveCourseConfirmations({
        periodId: period.id,
        date: open.date,
        slotNumber: open.slotNumber,
        tutorIds,
      });
      if (result.ok) {
        setNotice({
          type: "ok",
          text: `${shortDate(open.date)} ${open.slotLabel} に ${result.inserted} 名を確定しました。`,
        });
        setOpen(null);
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
      }
    });
  }

  // モーダル内: 提出者以外で確定済みになっている tutor (= 提出後に取り消した?)。
  // post-merge fix: name を orphanTutors から解決して checkbox 描画できるようにする。
  const orphanInCell = useMemo<HeatmapTutor[]>(() => {
    if (!open) return [];
    const submitted = new Set(open.tutors.map((t) => t.id));
    return open.initialConfirmedIds
      .filter((id) => !submitted.has(id))
      .map((id) => orphanTutors[id] ?? { id, name: `(不明な講師: ${id})` });
  }, [open, orphanTutors]);

  const dirty = useMemo(() => {
    if (!open) return false;
    const initial = new Set(open.initialConfirmedIds);
    if (initial.size !== editedConfirmedIds.size) return true;
    for (const id of initial) if (!editedConfirmedIds.has(id)) return true;
    return false;
  }, [open, editedConfirmedIds]);

  return (
    <div className="space-y-3">
      {notice && (
        <p
          role="status"
          className={cn(
            "text-sm",
            notice.type === "ok" ? "text-primary" : "text-destructive",
          )}
        >
          {notice.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>色が濃いほど希望者が多い（最大 {maxCount} 名）</span>
        <span className="flex items-center gap-1">
          少
          {HEAT_ALPHA.slice(1).map((a) => (
            <span
              key={a}
              className="inline-block size-3 rounded-sm ring-1 ring-border"
              style={{ backgroundColor: `hsl(var(--accent) / ${a})` }}
            />
          ))}
          多
        </span>
        <span>セルをクリックで希望者一覧 + 確定操作</span>
        <span className="flex items-center gap-1">
          <Check className="size-3 text-emerald-600" /> = 確定済人数
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[84px] border bg-muted p-2 text-left">
                コマ
              </th>
              {days.map((d) => (
                <th
                  key={d.date}
                  className={cn(
                    "border bg-muted px-2 py-1 text-center font-medium",
                    d.isWeekend && "text-muted-foreground",
                  )}
                >
                  <div className="whitespace-nowrap">{shortDate(d.date)}</div>
                  <div className="text-[10px] font-normal">
                    {d.weekdayLabel}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.slotNumber}>
                <th className="sticky left-0 z-10 min-w-[84px] border bg-muted p-2 text-left">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-[10px] font-normal text-muted-foreground">
                    {s.startTime}
                    {s.startTime && "〜"}
                    {s.endTime}
                  </div>
                </th>
                {days.map((d) => {
                  const key = `${d.date}|${s.slotNumber}`;
                  const c = counts[key] ?? 0;
                  const confirmedCount = (confirmedByCell[key] ?? []).length;
                  const level = heatLevel(c, maxCount);
                  const a = HEAT_ALPHA[level];
                  const dark = level >= 3;
                  const cellInteractive = c > 0 || confirmedCount > 0;
                  return (
                    <td key={d.date} className="border p-0">
                      <button
                        type="button"
                        disabled={!cellInteractive}
                        onClick={() => openCell(d.date, s.slotNumber, s.label)}
                        title={
                          cellInteractive
                            ? `${shortDate(d.date)} ${s.label}: 希望 ${c} 名 / 確定 ${confirmedCount} 名`
                            : undefined
                        }
                        className={cn(
                          "flex h-9 w-12 flex-col items-center justify-center text-xs tabular-nums leading-none transition-colors",
                          cellInteractive
                            ? "cursor-pointer hover:ring-2 hover:ring-ring"
                            : "cursor-default text-muted-foreground/40",
                          dark && "font-medium text-accent-foreground",
                        )}
                        style={{
                          backgroundColor:
                            a > 0 ? `hsl(var(--accent) / ${a})` : undefined,
                        }}
                      >
                        <span>{c > 0 ? c : "·"}</span>
                        {confirmedCount > 0 && (
                          <span
                            className={cn(
                              "flex items-center gap-0.5 text-[10px]",
                              dark
                                ? "text-emerald-200"
                                : "text-emerald-700 dark:text-emerald-300",
                            )}
                          >
                            <Check className="size-2.5" />
                            {confirmedCount}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(null)}
        >
          <Card
            className="w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <CardContent className="space-y-3 py-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  {shortDate(open.date)} {open.slotLabel}
                  <Badge variant="secondary" className="ml-2">
                    希望 {open.tutors.length} 名
                  </Badge>
                  <Badge variant="default" className="ml-1">
                    確定 {editedConfirmedIds.size} 名
                  </Badge>
                </div>
                <button
                  type="button"
                  aria-label="閉じる"
                  onClick={() => setOpen(null)}
                  className="rounded p-1 hover:bg-muted"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                希望者の前のチェックで確定をトグル。「保存」で当該コマの確定講師リストを置き換えます。
              </p>
              {open.tutors.length === 0 && orphanInCell.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  希望者はいません。
                </p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                  {open.tutors.map((t) => {
                    const checked = editedConfirmedIds.has(t.id);
                    return (
                      <li key={t.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/50",
                            checked && "bg-emerald-50 dark:bg-emerald-950/30",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTutor(t.id)}
                            disabled={isPending}
                          />
                          <span>{t.name}</span>
                          {checked && (
                            <Check className="ml-auto size-3 text-emerald-600" />
                          )}
                        </label>
                      </li>
                    );
                  })}
                  {orphanInCell.length > 0 && (
                    <>
                      <li className="pt-2 text-[10px] uppercase tracking-wide text-amber-800 dark:text-amber-300">
                        希望未提出だが確定済 ({orphanInCell.length} 名) — チェックを外して保存で取消
                      </li>
                      {orphanInCell.map((t) => {
                        const checked = editedConfirmedIds.has(t.id);
                        return (
                          <li key={t.id}>
                            <label
                              className={cn(
                                "flex cursor-pointer items-center gap-2 rounded border border-amber-200 bg-amber-50/60 px-2 py-1 hover:bg-amber-100/60 dark:border-amber-900 dark:bg-amber-950/30",
                                checked && "bg-amber-100/80 dark:bg-amber-950/50",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleTutor(t.id)}
                                disabled={isPending}
                              />
                              <span>{t.name}</span>
                              <span className="text-[10px] text-amber-800 dark:text-amber-300">
                                (希望未提出)
                              </span>
                              {checked && (
                                <Check className="ml-auto size-3 text-emerald-600" />
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </>
                  )}
                </ul>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(null)}
                  disabled={isPending}
                >
                  キャンセル
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={isPending || !dirty}
                  className={cn(dirty && "ring-2 ring-primary/40")}
                >
                  <Check className="mr-1 size-4" />
                  保存 ({editedConfirmedIds.size} 名)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
