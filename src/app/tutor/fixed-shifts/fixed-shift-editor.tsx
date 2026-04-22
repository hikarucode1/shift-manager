"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { WEEKDAYS, type Weekday } from "@/lib/shift-constants";
import { saveFixedShifts } from "./actions";

type Slot = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};

type Entry = { weekday: Weekday; slotNumber: number };

function cellKey(weekday: Weekday, slotNumber: number) {
  return `${weekday}:${slotNumber}`;
}

export function FixedShiftEditor({
  slots,
  initialEntries,
  initialEffectiveFrom,
}: {
  slots: Slot[];
  initialEntries: Entry[];
  initialEffectiveFrom: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialEntries.map((e) => cellKey(e.weekday, e.slotNumber))),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(initialEffectiveFrom);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const selectedCount = selected.size;

  const entries = useMemo<Entry[]>(
    () =>
      [...selected].map((k) => {
        const [weekday, slotNumber] = k.split(":") as [Weekday, string];
        return { weekday, slotNumber: Number(slotNumber) };
      }),
    [selected],
  );

  function toggle(weekday: Weekday, slotNumber: number) {
    const key = cellKey(weekday, slotNumber);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveFixedShifts({ effectiveFrom, entries });
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
              {WEEKDAYS.map((w) => (
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
                {WEEKDAYS.map((w) => {
                  const active = selected.has(cellKey(w.key, slot.slotNumber));
                  return (
                    <td key={w.key} className="p-0">
                      <button
                        type="button"
                        onClick={() => toggle(w.key, slot.slotNumber)}
                        aria-pressed={active}
                        className={cn(
                          "flex h-11 w-full items-center justify-center rounded-md border text-sm transition-colors",
                          active
                            ? "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                            : "border-input bg-background hover:bg-muted",
                        )}
                      >
                        {active ? "○" : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            選択中: {selectedCount} 枠
          </span>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "保存中..." : "保存"}
          </Button>
        </div>
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
