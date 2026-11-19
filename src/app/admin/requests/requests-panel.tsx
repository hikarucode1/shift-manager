"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import type { PendingAbsence } from "@/lib/absences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { shortDate } from "@/lib/week";
import { cn } from "@/lib/utils";
import { avatarColor, avatarInitial } from "@/lib/avatar";
import { decideAbsenceRequest } from "@/app/tutor/absences/actions";
import { pendingAbsenceActions } from "@/lib/pending-absence-actions";
import { closeUnassignedAbsence } from "./absence-actions";

export function RequestsPanel({
  pending,
  tutors,
}: {
  pending: PendingAbsence[];
  /** #331: 承認するときに「代講を頼む相手」に選べる講師 */
  tutors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  // 却下入力中の行 id → 理由
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  // #331: カードごとの「代講を頼む相手」(承認時に送る。空 = 指定しない)
  const [designated, setDesignated] = useState<Record<string, string>>({});
  // 本番チェック メモ21・23: 承認と一緒にする次の一手 (既定は「何もしない」)
  const [followUp, setFollowUp] = useState<
    Record<string, "designate" | "recruit" | "none">
  >({});

  // 却下の入力中のカードが、読み直しで却下を出せなくなったら (担当でない,
  // #289)、入力内容を捨てる。どの操作の読み直しでも効くよう、描画のたびに
  // 確かめる (React の「前の描画の情報で state を直す」パターン。effect で
  // やると lint の set-state-in-effect に当たる)。残すと、あとで担当に戻った
  // とき古い入力欄が出る
  const rejectCard =
    rejectId === null ? undefined : pending.find((p) => p.id === rejectId);
  if (rejectCard && !pendingAbsenceActions(rejectCard).canReject) {
    setRejectId(null);
    setRejectNote("");
  }

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
    opts: {
      onOk?: () => void;
      /**
       * 失敗したときも画面を読み直すか。サーバで「今は担当ではない」と弾かれた
       * とき (#289)、カードを開いたまま担当が変わっていたので、読み直して
       * 「不要として閉じる」の出し分けに切り替える
       */
      refreshOnError?: boolean;
    } = {},
  ) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn().catch(toFailedResult);
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
        opts.onOk?.();
        router.refresh();
      } else {
        setNotice({ type: "error", text: res.error ?? "失敗しました。" });
        // #202: reject 由来は「書いたか不明」。画面を古いまま放置せず
        // サーバーの真実を取りに行く (返り値の { ok: false } は確実に
        // 書いていないので触らない)。
        if (isIndeterminate(res) || opts.refreshOnError) router.refresh();
      }
    });
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
          {notice.type === "error" ? (
            <AlertCircle className="size-4" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {notice.text}
        </p>
      )}

      {pending.length === 0 ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          未対応の欠勤申請はありません。
        </p>
      ) : (
        <div className="space-y-3">
          {pending.map((p) => {
            // 担当が変わったコマは、出す操作と案内を切り替える (#289)
            const actions = pendingAbsenceActions(p);
            return (
              <div key={p.id} className="space-y-3 rounded-lg border p-3.5">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                      avatarColor(p.tutorId),
                    )}
                    aria-hidden
                  >
                    {avatarInitial(p.tutorName)}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.tutorName}</span>
                      <Badge variant="accent">未対応</Badge>
                      {/* #211: 承認は塞がない (後から欠勤を登録するのは正当な実務)。
                        ただし過去のコマを承認しようとしていることは分かるように */}
                      {p.isEnded && (
                        <Badge variant="outline" className="text-[10px]">
                          実施済み
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {shortDate(p.date)}（{p.weekdayLabel}） {p.slotLabel}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      理由: {p.reason}
                    </p>
                    {/* #211: 「実施済み = 押してはいけない」と誤読されないように。
                      後から欠勤を登録するのは正当な実務なので承認してよい */}
                    {actions.showEndedHint && (
                      <p className="text-xs text-muted-foreground">
                        終了したコマです。実際に欠勤していた場合は承認して構いません。
                      </p>
                    )}
                    {actions.notice && (
                      <p className="text-xs font-medium text-foreground">
                        {actions.notice}
                      </p>
                    )}
                  </div>
                </div>

                {/* 却下が出せないカード (担当でない, #289) では入力欄も出さない。
                    入力中に担当が変わって読み直された場合も、ここで閉じる */}
                {rejectId === p.id && actions.canReject ? (
                  <div className="space-y-2">
                    <textarea
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder="却下の理由を入力（講師に表示されます）"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isPending || !rejectNote.trim()}
                        onClick={() =>
                          run(
                            () =>
                              decideAbsenceRequest({
                                id: p.id,
                                decision: "rejected",
                                decisionNote: rejectNote.trim(),
                              }),
                            "却下しました。",
                            {
                              onOk: () => {
                                setRejectId(null);
                                setRejectNote("");
                              },
                              // 担当でないと弾かれたら、読み直して「不要として
                              // 閉じる」に切り替える (#289)。入力内容は、読み
                              // 直した描画で却下を出せなくなったときに捨てる
                              // (上の rejectCard)。通信エラーなどでは残る (#202)
                              refreshOnError: true,
                            },
                          )
                        }
                      >
                        却下を確定
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRejectId(null);
                          setRejectNote("");
                        }}
                      >
                        やめる
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* 本番チェック メモ21・23: 承認と一緒に、代講を
                      「指名する／募集に出す／何もしない」から選ぶ。指名は
                      その講師に教室長から直接依頼が届く (休む講師は挟まない) */}
                    {actions.canApprove && !p.isEnded && (
                      <fieldset className="space-y-2 rounded-md border p-2.5">
                        <legend className="px-1 text-xs text-muted-foreground">
                          代講をどうしますか
                        </legend>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          {(
                            [
                              ["designate", "代講を指名する"],
                              ["recruit", "代講を募集に出す"],
                              ["none", "何もしない"],
                            ] as const
                          ).map(([v, label]) => (
                            <label
                              key={v}
                              className="flex cursor-pointer items-center gap-1.5"
                            >
                              <input
                                type="radio"
                                name={`followup-${p.id}`}
                                value={v}
                                checked={(followUp[p.id] ?? "none") === v}
                                onChange={() =>
                                  setFollowUp((prev) => ({ ...prev, [p.id]: v }))
                                }
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                        {followUp[p.id] === "designate" && (
                          <div className="flex flex-wrap items-center gap-2">
                            <label
                              htmlFor={`designate-${p.id}`}
                              className="text-xs text-muted-foreground"
                            >
                              指名する講師
                            </label>
                            <select
                              id={`designate-${p.id}`}
                              value={designated[p.id] ?? ""}
                              onChange={(e) =>
                                setDesignated((prev) => ({
                                  ...prev,
                                  [p.id]: e.target.value,
                                }))
                              }
                              className="h-8 min-w-[10rem] rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              <option value="">選んでください</option>
                              {tutors
                                .filter((t) => t.id !== p.tutorId)
                                .map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {followUp[p.id] === "designate"
                            ? "承認すると、選んだ講師に代講の依頼が届きます。引き受けてもらえた時点で代講が決まります。"
                            : followUp[p.id] === "recruit"
                              ? "承認すると代講の募集に出し、出られる講師全員に知らせます。"
                              : "承認だけします。代講はあとから決められます。"}
                        </p>
                      </fieldset>
                    )}
                    <div className="flex gap-2">
                      {actions.canApprove && (
                        <Button
                          size="sm"
                          disabled={
                            isPending ||
                            (!p.isEnded &&
                              followUp[p.id] === "designate" &&
                              !designated[p.id])
                          }
                          onClick={() =>
                            run(
                              () =>
                                decideAbsenceRequest({
                                  id: p.id,
                                  decision: "approved",
                                  followUp: p.isEnded
                                    ? "none"
                                    : (followUp[p.id] ?? "none"),
                                  designatedSubstituteId:
                                    designated[p.id] || null,
                                }),
                              (followUp[p.id] ?? "none") === "designate" &&
                                !p.isEnded
                                ? "承認しました。指名した講師に代講の依頼を送りました。"
                                : (followUp[p.id] ?? "none") === "recruit" &&
                                    !p.isEnded
                                  ? "承認し、代講の募集に出しました。"
                                  : "承認しました。",
                              { refreshOnError: true },
                            )
                          }
                        >
                          承認
                        </Button>
                      )}
                      {actions.canReject && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => {
                            setRejectId(p.id);
                            setRejectNote("");
                          }}
                        >
                          却下
                        </Button>
                      )}
                      {actions.canClose && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => closeUnassignedAbsence({ id: p.id }),
                              "不要として閉じました。講師に通知が届きます。",
                              // 今も担当で弾かれたら、読み直して承認 / 却下に戻す
                              { refreshOnError: true },
                            )
                          }
                        >
                          不要として閉じる
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
