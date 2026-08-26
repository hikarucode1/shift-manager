"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import { toFailedResult, isIndeterminate } from "@/lib/action-failure";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createOpenSwapOnBehalf } from "./swap-actions";
import {
  listAssignmentsForDate,
  type AssignmentOption,
} from "./assignment-actions";

/**
 * 教室長が代理で代講を募集するフォーム (#227)。
 *
 * 講師が自分で出す交代・代講申請 (`/tutor/swaps`) とは別の入口。欠勤が確定した
 * コマの穴を教室長が埋めにいくためのもので、**同一コマに欠勤があっても塞がない**
 * (それが本命)。
 *
 * ⚠️ 過去日は選べない。承認側 (`decideSwapRequest`) が過去日を拒否するので、
 * 作っても誰も承認できない死に行になる。過去のコマは #215 の管轄。
 */
export function OpenSwapOnBehalfForm({ today }: { today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [assignments, setAssignments] = useState<AssignmentOption[] | null>(null);
  const [picked, setPicked] = useState("");
  const [reason, setReason] = useState("");
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  const load = useCallback((d: string) => {
    startLoading(async () => {
      const res = await listAssignmentsForDate({ date: d, purpose: "swap" }).catch(toFailedResult);
      if (!res.ok) {
        setAssignments([]);
        setNotice({ type: "error", text: res.error });
        return;
      }
      setAssignments(res.assignments);
      setPicked("");
    });
  }, []);

  useEffect(() => {
    if (open) load(date);
  }, [open, date, load]);

  function submit() {
    const [tutorId, slot] = picked.split("|");
    const trimmed = reason.trim();
    if (!tutorId || !slot) {
      setNotice({ type: "error", text: "対象のコマを選んでください。" });
      return;
    }
    if (!trimmed) {
      setNotice({ type: "error", text: "理由を入力してください。" });
      return;
    }
    setNotice(null);
    startSaving(async () => {
      const res = await createOpenSwapOnBehalf({
        tutorId,
        date,
        slotNumber: Number(slot),
        reason: trimmed,
      }).catch(toFailedResult);
      if (!res.ok) {
        setNotice({ type: "error", text: res.error });
        if (isIndeterminate(res)) router.refresh();
        return;
      }
      setNotice({
        type: "ok",
        text: "募集しました。応募があれば「未対応」タブに出ます。",
      });
      setReason("");
      setPicked("");
      load(date);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        代理で代講を募集する
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          欠勤が決まったコマの代講を、教室長から募集します。応募資格のある講師全員に
          通知が飛び、応募があれば「未対応」タブで承認します。休む講師本人にも
          「代講を募集した」ことが通知されます。
        </p>

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

        <div className="space-y-1">
          <label className="block text-xs" htmlFor="on-behalf-swap-date">
            日付
          </label>
          <input
            id="on-behalf-swap-date"
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs" htmlFor="on-behalf-swap-slot">
            対象のコマ
          </label>
          <select
            id="on-behalf-swap-slot"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            disabled={loading || !assignments || assignments.length === 0}
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value="">
              {loading
                ? "読み込み中…"
                : !assignments || assignments.length === 0
                  ? "この日に確定シフトがありません"
                  : "選択してください"}
            </option>
            {(assignments ?? []).map((a) => (
              <option
                key={`${a.tutorId}|${a.slotNumber}`}
                value={`${a.tutorId}|${a.slotNumber}`}
                disabled={a.blocked}
              >
                {a.slotLabel} {a.tutorName}
                {a.note ? `（${a.note}）` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs" htmlFor="on-behalf-swap-reason">
            募集の理由（必須）
          </label>
          <textarea
            id="on-behalf-swap-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="例: 体調不良による欠勤のため代講を募集（講師に表示されます）"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={saving || loading || !picked || !reason.trim()}
            onClick={submit}
          >
            募集する
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => {
              setOpen(false);
              setNotice(null);
              setReason("");
              setPicked("");
            }}
          >
            やめる
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
