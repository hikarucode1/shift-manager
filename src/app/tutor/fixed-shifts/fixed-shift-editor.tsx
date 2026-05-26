"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { INPUT_WEEKDAYS, type InputWeekday } from "@/lib/shift-constants";
import { saveFixedShifts } from "./actions";

type Slot = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};

// 'no' は cellState 不在で表現する (Issue #55)
type Availability = "yes" | "maybe";

type Entry = {
  weekday: InputWeekday;
  slotNumber: number;
  availability: Availability;
};

export type FixedShiftSubmissionMeta = {
  effectiveTo: string | null;
  desiredDays: number | null;
  desiredSlots: number | null;
  note: string | null;
};

function cellKey(weekday: InputWeekday, slotNumber: number) {
  return `${weekday}:${slotNumber}`;
}

// 3値サイクル: yes (○) → maybe (△) → no (空) → yes
function cycleNext(current: Availability | undefined): Availability | undefined {
  if (current === "yes") return "maybe";
  if (current === "maybe") return undefined;
  return "yes";
}

function symbolFor(a: Availability | undefined): string {
  if (a === "yes") return "○";
  if (a === "maybe") return "△";
  return "";
}

function numberOrNull(s: string): number | null {
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function FixedShiftEditor({
  slots,
  initialEntries,
  initialEffectiveFrom,
  initialMeta,
}: {
  slots: Slot[];
  initialEntries: Entry[];
  initialEffectiveFrom: string;
  initialMeta: FixedShiftSubmissionMeta;
}) {
  const [cellStates, setCellStates] = useState<Map<string, Availability>>(
    () => new Map(initialEntries.map((e) => [cellKey(e.weekday, e.slotNumber), e.availability])),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(initialEffectiveFrom);
  const [effectiveTo, setEffectiveTo] = useState<string>(initialMeta.effectiveTo ?? "");
  const [desiredDays, setDesiredDays] = useState<string>(
    initialMeta.desiredDays != null ? String(initialMeta.desiredDays) : "",
  );
  const [desiredSlots, setDesiredSlots] = useState<string>(
    initialMeta.desiredSlots != null ? String(initialMeta.desiredSlots) : "",
  );
  const [note, setNote] = useState<string>(initialMeta.note ?? "");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const yesCount = useMemo(
    () => [...cellStates.values()].filter((v) => v === "yes").length,
    [cellStates],
  );
  const maybeCount = useMemo(
    () => [...cellStates.values()].filter((v) => v === "maybe").length,
    [cellStates],
  );

  const entries = useMemo<Entry[]>(
    () =>
      [...cellStates.entries()].map(([k, availability]) => {
        const [weekday, slotNumber] = k.split(":") as [InputWeekday, string];
        return { weekday, slotNumber: Number(slotNumber), availability };
      }),
    [cellStates],
  );

  function cycle(weekday: InputWeekday, slotNumber: number) {
    const key = cellKey(weekday, slotNumber);
    setCellStates((prev) => {
      const next = new Map(prev);
      const after = cycleNext(prev.get(key));
      if (after === undefined) next.delete(key);
      else next.set(key, after);
      return next;
    });
  }

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveFixedShifts({
        effectiveFrom,
        effectiveTo: effectiveTo === "" ? null : effectiveTo,
        desiredDays: numberOrNull(desiredDays),
        desiredSlots: numberOrNull(desiredSlots),
        note: note.trim() === "" ? null : note,
        entries,
      });
      if (result.ok) {
        setMessage({ type: "success", text: "保存しました。次の週から適用されます。" });
      } else {
        setMessage({ type: "error", text: result.error });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="w-16 text-xs font-medium text-muted-foreground"></th>
              {INPUT_WEEKDAYS.map((w) => (
                <th
                  key={w.key}
                  className="text-xs font-medium text-muted-foreground"
                >
                  {w.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot.slotNumber}>
                <th className="text-left text-xs font-medium text-muted-foreground">
                  <div>{slot.label}</div>
                  <div className="text-[10px] text-muted-foreground/80">
                    {slot.startTime}–{slot.endTime}
                  </div>
                </th>
                {INPUT_WEEKDAYS.map((w) => {
                  const state = cellStates.get(cellKey(w.key, slot.slotNumber));
                  const isYes = state === "yes";
                  const isMaybe = state === "maybe";
                  return (
                    <td key={w.key} className="p-0">
                      <button
                        type="button"
                        onClick={() => cycle(w.key, slot.slotNumber)}
                        aria-label={`${w.label} ${slot.label} ${
                          isYes ? "出勤可" : isMaybe ? "可だが避けたい" : "不可"
                        }`}
                        className={cn(
                          "flex h-11 w-full items-center justify-center rounded-md border text-sm transition-colors",
                          isYes &&
                            "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
                          isMaybe &&
                            "border-amber-500 bg-amber-50 text-amber-900 shadow-sm hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-100",
                          !state && "border-input bg-background hover:bg-muted",
                        )}
                      >
                        {symbolFor(state)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          タップで ○ (出勤可) → △ (可だが避けたい) → 空 (不可) を切り替えます。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="effective-from">適用開始日</Label>
          <Input
            id="effective-from"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="w-44"
          />
          <p className="text-xs text-muted-foreground">
            この日以降の週から新しい設定が適用されます。
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="effective-to">適用終了日 (任意)</Label>
          <Input
            id="effective-to"
            type="date"
            value={effectiveTo}
            min={effectiveFrom}
            onChange={(e) => setEffectiveTo(e.target.value)}
            className="w-44"
          />
          <p className="text-xs text-muted-foreground">
            空欄の場合は無期限。「いつまでこのシフトで出勤できるか」を伝えるときに記入。
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="desired-days">希望出勤日数 (任意)</Label>
          <Input
            id="desired-days"
            type="number"
            inputMode="numeric"
            min={0}
            max={31}
            value={desiredDays}
            onChange={(e) => setDesiredDays(e.target.value)}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            目安として 1 ヶ月で出勤したい日数を記入 (整数)。
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="desired-slots">希望出勤コマ数 (任意)</Label>
          <Input
            id="desired-slots"
            type="number"
            inputMode="numeric"
            min={0}
            max={200}
            value={desiredSlots}
            onChange={(e) => setDesiredSlots(e.target.value)}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            目安として 1 ヶ月で出勤したいコマ数を記入 (整数)。
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">フリースペース (任意)</Label>
        <textarea
          id="note"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="特記事項があれば記入してください (例: 一時的な事情、要望)"
        />
        <p className="text-xs text-muted-foreground">{note.length} / 1000</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-muted-foreground">
          選択中: ○ {yesCount} 枠 / △ {maybeCount} 枠
        </span>
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "保存中..." : "保存"}
        </Button>
      </div>

      {message && (
        <p
          role="status"
          className={cn(
            "text-sm",
            message.type === "success" ? "text-primary" : "text-destructive",
          )}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
