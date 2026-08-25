"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import { toFailedResult, isIndeterminate } from "@/lib/action-failure";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  createAbsenceOnBehalf,
  listAssignmentsForDate,
  type AssignmentOption,
} from "./absence-actions";

/**
 * 教室長が代理で欠勤を登録するフォーム (#217)。
 *
 * 事前に分かっている欠勤は講師がサイトから申請する (従来フロー)。こちらは
 * **電話 / LINE / 直接で来た急な欠勤**を教室長が記録するための入口。
 * 過去日を選べることが目的なので、日付に下限を設けていない。
 */
export function AbsenceOnBehalfForm({ today }: { today: string }) {
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
      const res = await listAssignmentsForDate({ date: d }).catch(toFailedResult);
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
      const res = await createAbsenceOnBehalf({
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
        text: res.pendingSwap
          ? "登録しました。このコマには未処理の交代申請が残っています。交代・代講タブで処理してください。"
          : "登録しました。講師に通知が届きます。",
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
        代理で欠勤を登録する
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          電話・LINE・直接など、サイト外で受けた欠勤連絡を記録します。承認済みとして
          登録され、週次シフト表にすぐ反映されます。過去の日付も選べます。
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
          <label className="block text-xs" htmlFor="on-behalf-date">
            日付
          </label>
          <input
            id="on-behalf-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs" htmlFor="on-behalf-slot">
            対象のコマ
          </label>
          <select
            id="on-behalf-slot"
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
                disabled={a.alreadyRequested}
              >
                {a.slotLabel} {a.tutorName}
                {a.alreadyRequested ? "（既に申請あり）" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs" htmlFor="on-behalf-reason">
            理由・連絡手段（必須）
          </label>
          <textarea
            id="on-behalf-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="例: 電話連絡あり、発熱のため（講師に表示されます）"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={saving || loading || !picked || !reason.trim()}
            onClick={submit}
          >
            登録する
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
