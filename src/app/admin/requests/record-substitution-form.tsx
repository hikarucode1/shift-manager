"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import { toFailedResult, isIndeterminate } from "@/lib/action-failure";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { recordSubstitution } from "./swap-actions";
import {
  listAssignmentsForDate,
  listEligibleSubstitutes,
  type AssignmentOption,
} from "./assignment-actions";

/**
 * 教室長が「このコマは誰が入ったか」を記録するフォーム (#215)。
 *
 * ⚠️ 代講の**募集** (#227) とは別物で、日付に制限がない。過去は「実際は B が
 * 入っていた」の事後記録、当日・未来は「電話で B に頼んで確定した」の記録。
 */
export function RecordSubstitutionForm({ today }: { today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [assignments, setAssignments] = useState<AssignmentOption[] | null>(null);
  const [picked, setPicked] = useState("");
  const [subs, setSubs] = useState<{ id: string; name: string }[] | null>(null);
  const [subId, setSubId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, startLoading] = useTransition();
  const [loadingSubs, startLoadingSubs] = useTransition();
  const [saving, startSaving] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  const load = useCallback((d: string) => {
    startLoading(async () => {
      const res = await listAssignmentsForDate({
        date: d,
        purpose: "record",
      }).catch(toFailedResult);
      if (!res.ok) {
        setAssignments([]);
        setNotice({ type: "error", text: res.error });
        return;
      }
      setAssignments(res.assignments);
      setPicked("");
      setSubs(null);
      setSubId("");
    });
  }, []);

  useEffect(() => {
    if (open) load(date);
  }, [open, date, load]);

  function pick(value: string) {
    setPicked(value);
    setSubs(null);
    setSubId("");
    if (!value) return;
    const [tutorId, slot] = value.split("|");
    startLoadingSubs(async () => {
      const res = await listEligibleSubstitutes({
        date,
        slotNumber: Number(slot),
        excludeTutorId: tutorId,
      }).catch(toFailedResult);
      if (!res.ok) {
        setSubs([]);
        setNotice({ type: "error", text: res.error });
        return;
      }
      setSubs(res.tutors);
    });
  }

  function submit() {
    const [tutorId, slot] = picked.split("|");
    const trimmed = reason.trim();
    if (!tutorId || !slot) {
      setNotice({ type: "error", text: "対象のコマを選んでください。" });
      return;
    }
    if (!subId) {
      setNotice({ type: "error", text: "代講者を選んでください。" });
      return;
    }
    if (!trimmed) {
      setNotice({ type: "error", text: "理由を入力してください。" });
      return;
    }
    setNotice(null);
    startSaving(async () => {
      const res = await recordSubstitution({
        tutorId,
        substituteId: subId,
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
          ? "記録しました。このコマには未処理の交代申請が残っています。担当が変わったため承認できないので、交代・代講タブで却下してください。"
          : "記録しました。週次シフト表の担当を差し替えました。",
      });
      setReason("");
      setPicked("");
      setSubs(null);
      setSubId("");
      load(date);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        代講を記録する
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          「このコマは実際に誰が入ったか」を記録します。週次シフト表の担当が
          その場で差し替わります。実施済みのコマも、これから入ることが決まっている
          コマも記録できます。間違えた場合は承認済みタブから取り消せます。
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
          <label className="block text-xs" htmlFor="record-date">
            日付
          </label>
          <input
            id="record-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs" htmlFor="record-slot">
            もともとの担当（コマ）
          </label>
          <select
            id="record-slot"
            value={picked}
            onChange={(e) => pick(e.target.value)}
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
              >
                {a.slotLabel} {a.tutorName}
                {a.note ? `（${a.note}）` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs" htmlFor="record-sub">
            実際に入った講師
          </label>
          <select
            id="record-sub"
            value={subId}
            onChange={(e) => setSubId(e.target.value)}
            disabled={loadingSubs || !subs || subs.length === 0}
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value="">
              {!picked
                ? "先にコマを選んでください"
                : loadingSubs
                  ? "読み込み中…"
                  : !subs || subs.length === 0
                    ? "このコマに入れる講師がいません"
                    : "選択してください"}
            </option>
            {(subs ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs" htmlFor="record-reason">
            経緯（必須）
          </label>
          <textarea
            id="record-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="例: 体調不良の連絡を受け、電話で代講を依頼（両講師に表示されます）"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={saving || loading || !picked || !subId || !reason.trim()}
            onClick={submit}
          >
            記録する
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
              setSubs(null);
              setSubId("");
            }}
          >
            やめる
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
