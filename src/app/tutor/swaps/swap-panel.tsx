"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
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
import { busySlotKey } from "@/lib/slot-key";
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
  busyBySlot,
}: {
  shifts: SwappableShift[];
  tutors: { id: string; name: string }[];
  requests: MySwapRequest[];
  /** #181: "date|slotNumber" → そのコマに出勤予定の講師 id */
  busyBySlot: Record<string, string[]>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<"named" | "open">("open");
  const [nominee, setNominee] = useState("");

  // #181: 選択中のコマに出勤予定の講師。指名先の候補から外す。
  //
  // ⚠️ 選択を state のリセットで面倒みないこと。**選択済みの option が後から
  // disabled になっても、select は値を保持し required も通る** (実測)。
  // busyBySlot はコマを触らなくても更新されうる (別の申請を取り消すと
  // revalidatePath → router.refresh() で props だけ入れ替わる) ので、
  // 「target が変わった瞬間に外す」形だと取りこぼす。導出にしておけば
  // 出勤状況が動いた時点で常に外れる。
  const busyTutorIds = busyBySlot[target] ?? [];
  const effectiveNominee = busyTutorIds.includes(nominee) ? "" : nominee;
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
      const res = await fn().catch(toFailedResult);
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
        onOk?.();
        router.refresh();
      } else {
        setNotice({ type: "error", text: res.error ?? "失敗しました。" });
        // #202: reject 由来は「書いたか不明」。画面を古いまま放置せず
        // サーバーの真実を取りに行く (返り値の { ok: false } は確実に
        // 書いていないので触らない)。
        if (isIndeterminate(res)) router.refresh();
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sel = shifts.find((s) => busySlotKey(s.date, s.slotNumber) === target);
    if (!sel) {
      setNotice({ type: "error", text: "対象のコマを選択してください。" });
      return;
    }
    // #181 の最終ガード。UI の disable はあくまで先出しなので、state の同期に
    // 穴が空いてもここで止める (サーバーは別途 isTutorBusyAt で弾く)。
    if (kind === "named" && !effectiveNominee) {
      setNotice({ type: "error", text: "指名する講師を選択してください。" });
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
          nominatedTutorId: kind === "named" ? effectiveNominee : null,
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
                    const val = busySlotKey(s.date, s.slotNumber);
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
                    value={effectiveNominee}
                    onChange={(e) => setNominee(e.target.value)}
                    required
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">— 選択してください —</option>
                    {tutors.map((t) => {
                      const busy = busyTutorIds.includes(t.id);
                      return (
                        <option key={t.id} value={t.id} disabled={busy}>
                          {t.name}
                          {busy ? "（同じコマに出勤予定）" : ""}
                        </option>
                      );
                    })}
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
                        {/* #215: recorded を足したので二値では嘘になる
                            (記録行が「代講募集」と出ていた) */}
                        {r.kind === "named"
                          ? `指名: ${r.nominatedName ?? "—"}`
                          : r.kind === "recorded"
                            ? "代講の記録"
                            : "代講募集"}
                      </Badge>
                      <Badge variant={st.variant}>{st.text}</Badge>
                      {/* #227: 自分で出していない募集が一覧に出るので、
                          本人の申請と区別が付くようにする */}
                      {r.kind === "recorded" ? (
                        <Badge variant="secondary">教室長が記録</Badge>
                      ) : (
                        r.isProxy && (
                          <Badge variant="secondary">教室長が募集</Badge>
                        )
                      )}
                      {/* ⚠️ 代理募集には出さない (#231)。サーバー側で塞いだので
                          押すと必ず失敗する dead button になる。#165/#178 で
                          admin 側の過去日承認について同じ判断をしている */}
                      {r.status === "pending" && !r.isProxy && (
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
                    {/* 取り消しボタンを出さない代わりに、依頼先を示す (#231)。
                        これが無いと講師は「取り下げたいがどうすればいいか」を
                        アプリ内で知る手段が無くなる */}
                    {r.status === "pending" && r.isProxy && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        この募集は教室長が作成したものです。取り下げが必要な場合は
                        教室長にご相談ください。
                      </p>
                    )}
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
