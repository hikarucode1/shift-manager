"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import type { UnfilledAbsence } from "@/lib/absences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { addDesignatedSubstitute } from "./absence-actions";
import { createOpenSwapOnBehalf } from "./swap-actions";

/**
 * #331: 承認済みで、まだ代講が決まっていない欠勤。
 * - 断られた: 「別の講師を指名する」(その講師に直接依頼が届く) か
 *   「代講を募集に出す」(今ある代理募集) を選ぶ
 * - 返事待ち (室長レビュー要望2): 待ったまま「ほかの講師にも指名する」。
 *   最初に引き受けた人で決まる (早い者勝ち)
 * - 代講なし (2026/11/21 本人): 代講を決めずに承認した (「何もしない」)。
 *   あとから必要になったら、ここで指名するか募集に出す
 */
const BADGE: Record<
  UnfilledAbsence["state"],
  { label: string; variant: "accent" | "secondary" | "outline" }
> = {
  declined: { label: "代講未定", variant: "accent" },
  requested: { label: "返事待ち", variant: "secondary" },
  none: { label: "代講なし", variant: "outline" },
};

const PICK_LABEL: Record<UnfilledAbsence["state"], string> = {
  declined: "別の講師を指名する",
  requested: "ほかの講師にも指名する",
  none: "講師を指名する",
};

export function UnfilledAbsencesPanel({
  absences,
  tutors,
}: {
  absences: UnfilledAbsence[];
  tutors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  // カードごとの「指定し直す相手」
  const [picked, setPicked] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn().catch(toFailedResult);
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
        router.refresh();
      } else {
        setNotice({ type: "error", text: res.error ?? "失敗しました。" });
        if (isIndeterminate(res)) router.refresh();
      }
    });
  }

  if (absences.length === 0 && !notice) return null;

  return (
    <div className="space-y-3">
      {notice && (
        <p
          role="status"
          className={cn(
            "flex items-center gap-1 text-sm",
            notice.type === "ok" ? "text-primary" : "text-destructive",
          )}
        >
          {notice.type === "error" ? (
            <AlertCircle className="size-4" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {notice.text}
        </p>
      )}
      {absences.map((a) => (
        <div key={a.id} className="space-y-3 rounded-lg border p-3.5">
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.tutorName}</span>
              <Badge variant={BADGE[a.state].variant}>
                {BADGE[a.state].label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {shortDate(a.date)}（{a.weekdayLabel}） {a.slotLabel} ／ 理由:{" "}
              {a.reason}
            </p>
            {a.state === "none" ? (
              <p className="text-sm">
                代講の指名も募集もしていません。必要になったら、講師を指名するか、募集に出せます。
              </p>
            ) : a.state === "declined" ? (
              <p className="text-sm">
                指名した {names(a.declinedNames)}
                に断られました。次の手を選んでください。
              </p>
            ) : (
              <p className="text-sm">
                {names(a.waitingNames)}の返事待ちです。
                {a.declinedNames.length > 0 &&
                  `（${names(a.declinedNames)}は断りました）`}
                返事が遅いときは、ほかの講師にも指名できます。先に引き受けた人で決まります。
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={`redesignate-${a.id}`}
              className="text-xs text-muted-foreground"
            >
              {PICK_LABEL[a.state]}
            </label>
            <select
              id={`redesignate-${a.id}`}
              value={picked[a.id] ?? ""}
              onChange={(e) =>
                setPicked((prev) => ({ ...prev, [a.id]: e.target.value }))
              }
              className="h-8 min-w-[10rem] rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">選んでください</option>
              {tutors
                // 休む本人と、返事待ちの講師と、一度断った講師は選べない
                .filter(
                  (t) =>
                    t.id !== a.tutorId &&
                    !a.waitingIds.includes(t.id) &&
                    !a.declinedIds.includes(t.id),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
            <Button
              size="sm"
              disabled={isPending || !picked[a.id]}
              onClick={() =>
                run(
                  () =>
                    addDesignatedSubstitute({
                      absenceId: a.id,
                      designatedSubstituteId: picked[a.id],
                    }),
                  "その講師に代講の依頼を送りました。",
                )
              }
            >
              指名する
            </Button>
          </div>

          {/* 返事待ちの依頼があるあいだは募集に出せない (同じコマに並べない) */}
          {a.state !== "requested" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(
                    () =>
                      createOpenSwapOnBehalf({
                        tutorId: a.tutorId,
                        date: a.date,
                        slotNumber: a.slotNumber,
                        reason: `欠勤（${a.reason}）`.slice(0, 500),
                      }),
                    "代講の募集に出しました。応募があれば「交代・代講」に出ます。",
                  )
                }
              >
                代講を募集に出す
              </Button>
              <span className="text-xs text-muted-foreground">
                出られる講師全員に知らせ、応募者の中から選びます
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** ["A", "B"] → "Aさん・Bさん" */
function names(list: string[]): string {
  return list.map((n) => `${n}さん`).join("・");
}
