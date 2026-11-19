"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toFailedResult } from "@/lib/action-failure";
import { SHIFT_REMINDER_HOURS } from "@/lib/shift-reminder-rule";
import { cn } from "@/lib/utils";
import { saveMyShiftReminder } from "@/app/tutor/me/actions";

const OPTIONS: { hours: number | null; label: string }[] = [
  { hours: null, label: "通知しない" },
  ...SHIFT_REMINDER_HOURS.map((h) => ({ hours: h, label: `${h}時間前` })),
];

/** メモ15: 出勤前のリマインドを何時間前に受け取るか。押したらすぐ保存する */
export function ShiftReminderForm({ initialHours }: { initialHours: number | null }) {
  const router = useRouter();
  const [hours, setHours] = useState<number | null>(initialHours);
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(next: number | null) {
    if (pending || next === hours) return;
    const prev = hours;
    setHours(next);
    setNotice(null);
    startTransition(async () => {
      const res = await saveMyShiftReminder({ hours: next }).catch(toFailedResult);
      if (res.ok) {
        setNotice({
          type: "ok",
          text:
            next === null
              ? "出勤前の通知をオフにしました。"
              : `出勤日は、最初のコマの${next}時間前にお知らせします。`,
        });
        router.refresh();
      } else {
        setHours(prev);
        setNotice({ type: "error", text: res.error ?? "保存できませんでした。" });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <BellRing className="size-4 text-muted-foreground" />
          出勤前の通知
        </CardTitle>
        <CardDescription>
          出勤する日に、その日の最初のコマの何時間前にお知らせするかを選べます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {OPTIONS.map((o) => {
            const on = o.hours === hours;
            return (
              <button
                key={o.label}
                type="button"
                disabled={pending}
                aria-pressed={on}
                onClick={() => pick(o.hours)}
                className={cn(
                  "flex h-11 items-center justify-center gap-1 rounded-lg border text-sm font-medium transition-colors",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted",
                )}
              >
                {on && <Check className="size-4" />}
                {o.label}
              </button>
            );
          })}
        </div>
        {notice && (
          <p
            role="status"
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              notice.type === "ok"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {notice.text}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          お知らせはベルに届きます。スマホに通知を出すには、
          <Link href="/tutor/notifications" className="underline underline-offset-2">
            「通知」の画面
          </Link>
          でスマホ通知をオンにしてください。
        </p>
      </CardContent>
    </Card>
  );
}
