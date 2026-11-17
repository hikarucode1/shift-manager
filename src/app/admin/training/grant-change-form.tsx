"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toFailedResult } from "@/lib/action-failure";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { grantTrainingChange } from "@/app/admin/requests/shift-change-actions";

/**
 * #333: 締切後に、1 人だけ講習の希望を直せるようにする (本人の要望、2026/11/17)。
 * 期間ごと「再開」すると全員が編集できてしまうので、それとは別の入口。
 */
export function GrantChangeForm({
  periodId,
  tutors,
  grants,
}: {
  periodId: string;
  tutors: { id: string; name: string }[];
  /** 今変更できる講師 (名前と期限の表示用) */
  grants: { tutorId: string; name: string; until: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tutorId, setTutorId] = useState("");
  const [message, setMessage] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tutorId) {
      setMessage({ type: "error", text: "講師を選んでください。" });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await grantTrainingChange({
        tutorId,
        trainingPeriodId: periodId,
      }).catch(toFailedResult);
      if (res.ok) {
        setMessage({
          type: "ok",
          text: "再開しました。本人に通知しました（3日間変更できます）。",
        });
        setTutorId("");
        router.refresh();
      } else {
        setMessage({ type: "error", text: res.error ?? "失敗しました。" });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">1人だけ再開する</CardTitle>
        <CardDescription>
          締切後に、選んだ講師だけ3日間希望を直せるようにします。ほかの講師は締切のままです。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <form className="flex flex-wrap gap-2" onSubmit={submit}>
          <select
            aria-label="再開する講師"
            value={tutorId}
            onChange={(e) => setTutorId(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">— 講師を選ぶ —</option>
            {tutors.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={isPending}>
            {isPending ? "再開中..." : "再開する"}
          </Button>
        </form>
        {message && (
          <p
            role="status"
            className={
              message.type === "ok" ? "text-primary" : "text-destructive"
            }
          >
            {message.text}
          </p>
        )}
        {grants.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              いま変更できる講師
            </p>
            <ul className="mt-1 space-y-0.5">
              {grants.map((g) => (
                <li key={g.tutorId}>
                  {g.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {g.until} まで
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
