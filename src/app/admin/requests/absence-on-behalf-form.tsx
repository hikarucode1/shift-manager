"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import { toFailedResult, isIndeterminate } from "@/lib/action-failure";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createAbsenceOnBehalf } from "./absence-actions";
import {
  listAssignmentsForDate,
  listEligibleSubstitutes,
  type AssignmentOption,
} from "./assignment-actions";

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
  // 本番チェック メモ25: 登録と一緒に、代講を「指名／募集／何もしない」
  const [followUp, setFollowUp] = useState<"designate" | "recruit" | "none">(
    "none",
  );
  // 読み込んだ候補は「どのコマの分か」と一緒に持ち、コマが変わったら使わない
  const [loadedSubs, setLoadedSubs] = useState<{
    key: string;
    tutors: { id: string; name: string }[];
  } | null>(null);
  const [subId, setSubId] = useState("");
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  const load = useCallback((d: string) => {
    startLoading(async () => {
      const res = await listAssignmentsForDate({ date: d, purpose: "absence" }).catch(toFailedResult);
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

  const pickedOption = assignments?.find(
    (a) => `${a.tutorId}|${a.slotNumber}` === picked,
  );
  const pickedEnded = pickedOption?.isEnded ?? false;

  // 指名できる講師 (そのコマに入っていない有効な講師) を読み込む
  const subsKey = `${date}|${picked}`;
  const subs = loadedSubs?.key === subsKey ? loadedSubs.tutors : null;
  useEffect(() => {
    const [tutorId, slot] = picked.split("|");
    if (!tutorId || !slot || followUp !== "designate") return;
    let cancelled = false;
    void listEligibleSubstitutes({
      date,
      slotNumber: Number(slot),
      excludeTutorId: tutorId,
    })
      .catch(toFailedResult)
      .then((res) => {
        if (cancelled) return;
        setLoadedSubs({ key: `${date}|${picked}`, tutors: res.ok ? res.tutors : [] });
      });
    return () => {
      cancelled = true;
    };
  }, [picked, date, followUp]);

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
      const fu = pickedEnded ? "none" : followUp;
      const res = await createAbsenceOnBehalf({
        tutorId,
        date,
        slotNumber: Number(slot),
        reason: trimmed,
        followUp: fu,
        designatedSubstituteId: fu === "designate" ? subId || null : null,
      }).catch(toFailedResult);
      if (!res.ok) {
        setNotice({ type: "error", text: res.error });
        if (isIndeterminate(res)) router.refresh();
        return;
      }
      const parts = ["登録しました。講師に通知が届きます。"];
      if (res.followUpError) {
        parts.push(
          `ただし代講の${fu === "designate" ? "依頼" : "募集"}はできませんでした: ${res.followUpError}`,
        );
      } else if (fu === "designate") {
        parts.push(`${res.designeeName ?? "指名した講師"}さんに代講の依頼を送りました。`);
      } else if (fu === "recruit") {
        parts.push("代講の募集に出しました。");
      } else if (pickedEnded) {
        parts.push(
          "実際に代講が入っていた場合は、「あとから代講を記録する」から記録してください。",
        );
      }
      if (res.pendingSwap) {
        parts.push(
          "このコマには未処理の交代申請が残っています。「未対応」タブで処理してください。",
        );
      }
      setNotice({ type: "ok", text: parts.join(" ") });
      setReason("");
      setPicked("");
      setFollowUp("none");
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
          登録され、登録済みシフトにすぐ反映されます。過去の日付も選べます。
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
            onChange={(e) => {
              setDate(e.target.value);
              setSubId("");
            }}
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
            onChange={(e) => {
              setPicked(e.target.value);
              setSubId("");
            }}
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

        {/* 本番チェック メモ25: 承認時と同じ 3 択。終わったコマでは出さない */}
        {picked && !pickedEnded && (
          <fieldset className="space-y-2 rounded-md border p-2.5">
            <legend className="px-1 text-xs text-muted-foreground">
              代講をどうしますか
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(
                [
                  ["designate", "代講を指名する"],
                  ["recruit", "代講を募集に出す"],
                  ["none", "何もしない"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="on-behalf-followup"
                    value={v}
                    checked={followUp === v}
                    onChange={() => setFollowUp(v)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {followUp === "designate" && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted-foreground" htmlFor="on-behalf-sub">
                  指名する講師
                </label>
                <select
                  id="on-behalf-sub"
                  value={subId}
                  onChange={(e) => setSubId(e.target.value)}
                  disabled={!subs}
                  className="h-8 min-w-[10rem] rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">
                    {!subs ? "読み込み中…" : subs.length === 0 ? "指名できる講師がいません" : "選んでください"}
                  </option>
                  {(subs ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {followUp === "designate"
                ? "登録すると、選んだ講師に代講の依頼が届きます。引き受けてもらえた時点で代講が決まります。"
                : followUp === "recruit"
                  ? "登録すると代講の募集に出し、出られる講師全員に知らせます。"
                  : "欠勤の登録だけします。代講はあとから決められます。"}
            </p>
          </fieldset>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={
              saving ||
              loading ||
              !picked ||
              !reason.trim() ||
              (!pickedEnded && followUp === "designate" && !subId)
            }
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
              setFollowUp("none");
            }}
          >
            やめる
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
