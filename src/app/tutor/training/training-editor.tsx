"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveTrainingNote, setTrainingSlot } from "./actions";

type SlotDef = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};
type Day = { date: string; weekdayLabel: string; isWeekend: boolean };
type Period = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  submissionDeadline: string;
  isReopened: boolean;
  daysLeft: number;
  editable: boolean;
};

export type TrainingEditorProps = {
  data: {
    period: Period;
    slots: SlotDef[];
    days: Day[];
    selected: string[];
    note: string;
  };
};

const key = (date: string, slot: number) => `${date}|${slot}`;

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function TrainingEditor({ data }: TrainingEditorProps) {
  const { period, slots, days } = data;
  const editable = period.editable;

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(data.selected),
  );
  const [note, setNote] = useState(data.note);
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);
  const [savingCount, setSavingCount] = useState(0);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const toggle = useCallback(
    async (date: string, slot: number) => {
      if (!editable) return;
      const k = key(date, slot);
      const turningOn = !selected.has(k);

      // 楽観的更新
      setSelected((prev) => {
        const next = new Set(prev);
        if (turningOn) next.add(k);
        else next.delete(k);
        return next;
      });
      setSavingCount((c) => c + 1);

      const res = await setTrainingSlot({
        periodId: period.id,
        date,
        slotNumber: slot,
        on: turningOn,
      });
      setSavingCount((c) => c - 1);

      if (!res.ok) {
        // 失敗 → ロールバック
        setSelected((prev) => {
          const next = new Set(prev);
          if (turningOn) next.delete(k);
          else next.add(k);
          return next;
        });
        setNotice({ type: "error", text: res.error });
      }
    },
    [editable, period.id, selected],
  );

  // 備考のデバウンス保存
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onNoteChange(v: string) {
    setNote(v);
    if (!editable) return;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(async () => {
      setSavingCount((c) => c + 1);
      const res = await saveTrainingNote({ periodId: period.id, note: v });
      setSavingCount((c) => c - 1);
      if (!res.ok) setNotice({ type: "error", text: res.error });
      else setNotice({ type: "ok", text: "保存しました" });
    }, 800);
  }

  const selectedCount = selected.size;

  return (
    <div className="space-y-4">
      {!editable && (
        <div className="flex items-center gap-2 rounded-md border border-muted bg-muted/50 px-3 py-2 text-sm">
          <Lock className="size-4" />
          提出締切を過ぎているため、閲覧のみ可能です（変更は教室長が再開放した場合のみ）。
        </div>
      )}

      {notice && (
        <p
          role="status"
          className={cn(
            "flex items-center gap-1 text-sm",
            notice.type === "ok" ? "text-primary" : "text-destructive",
          )}
        >
          {notice.type === "error" && <AlertCircle className="size-4" />}
          {notice.text}
        </p>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            勤務できるコマを選択
            <Badge variant="secondary" className="ml-2">
              選択 {selectedCount}
            </Badge>
          </CardTitle>
          {savingCount > 0 && (
            <span className="text-xs text-muted-foreground">保存中...</span>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {days.map((d) => (
              <div
                key={d.date}
                className="rounded-md border p-2 sm:flex sm:items-center sm:gap-3"
              >
                <div
                  className={cn(
                    "mb-2 w-24 shrink-0 text-sm font-medium sm:mb-0",
                    d.isWeekend && "text-muted-foreground",
                  )}
                >
                  {shortDate(d.date)}（{d.weekdayLabel}）
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((s) => {
                    const on = selected.has(key(d.date, s.slotNumber));
                    return (
                      <button
                        key={s.slotNumber}
                        type="button"
                        disabled={!editable}
                        onClick={() => toggle(d.date, s.slotNumber)}
                        title={`${s.startTime}〜${s.endTime}`}
                        aria-pressed={on}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs transition-colors",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted",
                          !editable && "cursor-not-allowed opacity-60",
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">備考</CardTitle>
        </CardHeader>
        <CardContent>
          <Label htmlFor="note" className="sr-only">
            備考
          </Label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            disabled={!editable}
            rows={3}
            maxLength={1000}
            placeholder="連絡事項があれば記入してください（例: 8/10〜8/15 は帰省のため不可）"
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 text-sm",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            入力すると自動保存されます。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
