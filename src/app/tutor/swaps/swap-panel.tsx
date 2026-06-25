"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import type { MySwapRequest, SwappableShift } from "@/lib/swaps";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { cancelSwapRequest, createSwapRequest } from "./actions";

const STATUS: Record<
  MySwapRequest["status"],
  { text: string; variant: "accent" | "secondary" | "destructive" | "outline" }
> = {
  pending: { text: "募集中 / 承認待ち", variant: "accent" },
  approved: { text: "成立", variant: "secondary" },
  rejected: { text: "却下", variant: "destructive" },
  cancelled: { text: "取消", variant: "outline" },
};

export function SwapPanel({
  shifts,
  tutors,
  requests,
}: {
  shifts: SwappableShift[];
  tutors: { id: string; name: string }[];
  requests: MySwapRequest[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<"named" | "open">("open");
  const [nominee, setNominee] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
    onOk?: () => void,
  ) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
        onOk?.();
        router.refresh();
      } else {
        setNotice({ type: "error", text: res.error ?? "失敗しました。" });
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sel = shifts.find((s) => `${s.date}|${s.slotNumber}` === target);
    if (!sel) {
      setNotice({ type: "error", text: "対象のコマを選択してください。" });
      return;
    }
    // native required は空白のみを通すため trim 後の空チェックで一貫させる
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setNotice({ type: "error", text: "理由を入力してください。" });
      return;
    }
    run(
      () =>
        createSwapRequest({
          date: sel.date,
          slotNumber: sel.slotNumber,
          reason: trimmedReason,
          kind,
          nominatedTutorId: kind === "named" ? nominee : null,
        }),
      "交代申請を送信しました。",
      () => {
        setTarget("");
        setReason("");
        setNominee("");
      },
    );
  }

  return (
    <div className="space-y-4">
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
        <CardHeader>
          <CardTitle className="text-base">新しい交代申請</CardTitle>
          <CardDescription>
            指名はその講師の応募（承諾）後、代講募集は応募者の中から教室長が承認します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shifts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              交代申請できる今後のシフトがありません。
            </p>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              {/* 1. 対象シフト選択 (排他選択 = native radio + fieldset/legend) */}
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">
                  対象のシフト
                </legend>
                <div className="space-y-2">
                  {shifts.map((s) => {
                    const val = `${s.date}|${s.slotNumber}`;
                    const on = target === val;
                    return (
                      <label
                        key={val}
                        className={cn(
                          "flex w-full cursor-pointer items-center justify-between rounded-xl border p-3 transition-colors focus-within:ring-1 focus-within:ring-ring",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted",
                        )}
                      >
                        <input
                          type="radio"
                          name="sw-target"
                          value={val}
                          checked={on}
                          onChange={() => setTarget(val)}
                          className="sr-only"
                        />
                        <span className="text-sm font-medium">
                          {shortDate(s.date)}（{s.weekdayLabel}） {s.slotLabel}
                        </span>
                        <span
                          className={cn(
                            "text-xs",
                            on
                              ? "text-primary-foreground/80"
                              : "text-muted-foreground",
                          )}
                        >
                          {s.startTime}–{s.endTime}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* 2. 種別 (代講募集 / 指名) */}
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">交代の方法</legend>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: "open", label: "代講を募集する" },
                      { value: "named", label: "指名する" },
                    ] as const
                  ).map((k) => {
                    const on = kind === k.value;
                    return (
                      <label
                        key={k.value}
                        className={cn(
                          "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors focus-within:ring-1 focus-within:ring-ring",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted",
                        )}
                      >
                        <input
                          type="radio"
                          name="sw-kind"
                          value={k.value}
                          checked={on}
                          onChange={() => setKind(k.value)}
                          className="sr-only"
                        />
                        {k.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {kind === "named" && (
                <div className="space-y-1.5">
                  <Label htmlFor="sw-nominee">指名する講師</Label>
                  <select
                    id="sw-nominee"
                    value={nominee}
                    onChange={(e) => setNominee(e.target.value)}
                    required
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">— 選択してください —</option>
                    {tutors.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 3. 理由 */}
              <div className="space-y-1.5">
                <Label htmlFor="sw-reason">理由（必須）</Label>
                <textarea
                  id="sw-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  rows={3}
                  maxLength={500}
                  placeholder="例: 体調不良のため"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {/* 4. 注意バナー (bg-accent/10) */}
              <div className="rounded-lg bg-accent/10 p-3 text-sm">
                <p className="flex items-start gap-2 text-foreground">
                  <Info className="mt-0.5 size-4 shrink-0 text-accent" />
                  <span>
                    指名はその講師の承諾後に成立します。代講募集は応募者の中から教室長が承認します。
                  </span>
                </p>
              </div>

              {/* 5. 下部 primary 全幅 */}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? "送信中..." : "交代を申請"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            申請履歴
            <Badge variant="secondary" className="ml-2">
              {requests.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              申請履歴はありません。
            </p>
          ) : (
            <div className="divide-y">
              {requests.map((r) => {
                const st = STATUS[r.status];
                return (
                  <div key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {shortDate(r.date)}（{r.weekdayLabel}） {r.slotLabel}
                      </span>
                      <Badge variant="outline">
                        {r.kind === "named"
                          ? `指名: ${r.nominatedName ?? "—"}`
                          : "代講募集"}
                      </Badge>
                      <Badge variant={st.variant}>{st.text}</Badge>
                      {r.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => cancelSwapRequest({ id: r.id }),
                              "申請を取り消しました。",
                            )
                          }
                        >
                          取り消し
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      理由: {r.reason}
                    </p>
                    {r.applicants.length > 0 && (
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        応募: {r.applicants.map((a) => a.applicantName).join(", ")}
                      </p>
                    )}
                    {r.status === "approved" && r.approvedApplicantName && (
                      <p className="mt-0.5 text-sm text-primary">
                        代講者: {r.approvedApplicantName}
                      </p>
                    )}
                    {r.decisionNote && (
                      <p className="mt-0.5 text-sm text-destructive">
                        教室長より: {r.decisionNote}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
