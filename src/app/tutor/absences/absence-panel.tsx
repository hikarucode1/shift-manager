"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, Info } from "lucide-react";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import type { TutorAbsenceRow, UpcomingShift } from "@/lib/absences";
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
import { cancelAbsenceRequest, createAbsenceRequest } from "./actions";
import { requestDesignatedSubstitute } from "@/app/tutor/swaps/designated-actions";

const STATUS_LABEL: Record<
  TutorAbsenceRow["status"],
  { text: string; variant: "secondary" | "destructive" | "outline" | "accent" }
> = {
  pending: { text: "承認待ち", variant: "accent" },
  approved: { text: "承認済み", variant: "secondary" },
  rejected: { text: "却下", variant: "destructive" },
  cancelled: { text: "取消", variant: "outline" },
};

/** 理由区分チップ (design handoff #133)。選択値を reason 先頭に合成する。 */
const REASON_CATEGORIES = ["体調不良", "私用", "学業", "その他"] as const;

export function AbsencePanel({
  upcoming,
  history,
}: {
  upcoming: UpcomingShift[];
  history: TutorAbsenceRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // at: どこに出すか。申請フォームの結果は送信ボタンのすぐ上に出す
  // (候補のコマが多いと画面上部の通知は見えず、送れたか分からなかった)
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string; at?: "form" } | null
  >(null);

  // 室長レビュー要望1: 複数のコマにチェックを付けてまとめて申請できる
  const [targets, setTargets] = useState<Set<string>>(() => new Set());
  const [category, setCategory] =
    useState<(typeof REASON_CATEGORIES)[number] | "">("");
  const [memo, setMemo] = useState("");

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
    onOk?: () => void,
    at?: "form",
  ) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn().catch(toFailedResult);
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg, at });
        onOk?.();
        router.refresh();
      } else {
        setNotice({ type: "error", text: res.error ?? "失敗しました。", at });
        // #202: reject 由来は「書いたか不明」。画面を古いまま放置せず
        // サーバーの真実を取りに行く (返り値の { ok: false } は確実に
        // 書いていないので触らない)。
        if (isIndeterminate(res)) router.refresh();
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sel = upcoming.filter((u) =>
      targets.has(`${u.date}|${u.slotNumber}`),
    );
    if (sel.length === 0) {
      setNotice({ type: "error", text: "対象のコマを選択してください。", at: "form" });
      return;
    }
    if (!category) {
      setNotice({ type: "error", text: "理由区分を選択してください。", at: "form" });
      return;
    }
    const trimmed = memo.trim();
    if (category === "その他" && !trimmed) {
      setNotice({
        type: "error",
        text: "「その他」を選んだ場合は詳細メモを入力してください。",
        at: "form",
      });
      return;
    }
    // backend は単一の reason 文字列のみ受け付ける (無改修) ため区分＋メモを合成
    const reason = trimmed ? `${category}（${trimmed}）` : category;
    run(
      () =>
        createAbsenceRequest({
          targets: sel.map((u) => ({ date: u.date, slotNumber: u.slotNumber })),
          reason,
        }),
      sel.length > 1
        ? `欠勤申請を ${sel.length} コマ分送信しました。`
        : "欠勤申請を送信しました。",
      () => {
        setTargets(new Set());
        setCategory("");
        setMemo("");
      },
      "form",
    );
  }

  return (
    <div className="space-y-4">
      {notice && !notice.at && <Notice notice={notice} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">新しい欠勤申請</CardTitle>
          <CardDescription>
            申請できるのは今日以降の自分の確定シフトです。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <div className="space-y-2">
              {/* 最後のコマを申請するとフォームが消えるので、結果はここに出す */}
              {notice?.at === "form" && <Notice notice={notice} />}
              <p className="py-4 text-center text-sm text-muted-foreground">
                申請できる今後のシフトがありません。
              </p>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              {/* 1. 対象シフト選択 (複数選択 = native checkbox + fieldset/legend) */}
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">
                  対象のシフト
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    （複数選べます
                    {targets.size > 0 && `・${targets.size} コマ選択中`}）
                  </span>
                </legend>
                <div className="space-y-2">
                  {upcoming.map((u) => {
                    const val = `${u.date}|${u.slotNumber}`;
                    const on = targets.has(val);
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
                          type="checkbox"
                          name="abs-target"
                          value={val}
                          checked={on}
                          onChange={() =>
                            setTargets((prev) => {
                              const next = new Set(prev);
                              if (next.has(val)) next.delete(val);
                              else next.add(val);
                              return next;
                            })
                          }
                          className="sr-only"
                        />
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span
                            aria-hidden
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded border",
                              on
                                ? "border-primary-foreground bg-primary-foreground text-primary"
                                : "border-muted-foreground/50",
                            )}
                          >
                            {on && <Check className="size-3" strokeWidth={3} />}
                          </span>
                          {shortDate(u.date)}（{u.weekdayLabel}） {u.slotLabel}
                        </span>
                        <span
                          className={cn(
                            "text-xs",
                            on
                              ? "text-primary-foreground/80"
                              : "text-muted-foreground",
                          )}
                        >
                          {u.startTime}–{u.endTime}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* 2. 理由区分チップ (排他選択 = native radio + fieldset/legend) */}
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">理由</legend>
                <div className="flex flex-wrap gap-2">
                  {REASON_CATEGORIES.map((c) => {
                    const on = category === c;
                    return (
                      <label
                        key={c}
                        className={cn(
                          "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors focus-within:ring-1 focus-within:ring-ring",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted",
                        )}
                      >
                        <input
                          type="radio"
                          name="abs-reason"
                          value={c}
                          checked={on}
                          onChange={() => setCategory(c)}
                          className="sr-only"
                        />
                        {c}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* 3. 詳細メモ */}
              <div className="space-y-1.5">
                <Label htmlFor="abs-memo">
                  詳細メモ
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {category === "その他" ? "（必須）" : "（任意）"}
                  </span>
                </Label>
                <textarea
                  id="abs-memo"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  rows={3}
                  maxLength={490}
                  placeholder="例: 通院のため"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {/* 4. 注意バナー (bg-accent/10) */}
              <div className="rounded-lg bg-accent/10 p-3 text-sm">
                <p className="flex items-start gap-2 text-foreground">
                  <Info className="mt-0.5 size-4 shrink-0 text-accent" />
                  <span>
                    欠勤申請には教室長の承認が必要です。承認後、教室長が代講募集に出す場合があります。
                  </span>
                </p>
              </div>

              {notice?.at === "form" && <Notice notice={notice} />}

              {/* 5. 下部 primary 全幅 */}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending
                  ? "送信中..."
                  : targets.size > 1
                    ? `${targets.size} コマの欠勤を申請`
                    : "欠勤を申請"}
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
              {history.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              申請履歴はありません。
            </p>
          ) : (
            <div className="divide-y">
              {history.map((h) => {
                // #331: 指定した相手が引き受けて成立した欠勤は、自動失効で
                // 「取消」になっているが、本人には「代講が決まった」と見せる
                const designatedAccepted = h.designation.kind === "accepted";
                const st = designatedAccepted
                  ? { text: "代講決定", variant: "secondary" as const }
                  : STATUS_LABEL[h.status];
                return (
                  <div key={h.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {shortDate(h.date)}（{h.weekdayLabel}） {h.slotLabel}
                      </span>
                      <Badge variant={st.variant}>{st.text}</Badge>
                      {/* #217: 自分で出していない行が「承認済み」とだけ出ると、
                          自分が申請したものと区別が付かない */}
                      {h.isProxy && (
                        <Badge variant="secondary">教室長が登録</Badge>
                      )}
                      {h.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => cancelAbsenceRequest({ id: h.id }),
                              "申請を取り消しました。",
                            )
                          }
                        >
                          取り消し
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      理由: {h.reason}
                    </p>
                    {h.decisionNote &&
                      !designatedAccepted &&
                      (h.autoExpired ? (
                        // ⚠️ 自動失効は誰の判断でもない (#225 で admin 側は
                        // decided_by を null にして誤帰属を消した)。ここで
                        // 「教室長より」と出すと、教室長が言っていないことを
                        // 言ったことになる。赤字にもしない — 本人への指摘や
                        // 却下理由ではなく、状態の説明なので
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {h.decisionNote}（このコマは代講が入ったため、欠勤の記録は不要になりました）
                        </p>
                      ) : h.expiredUnassigned ? (
                        // ⚠️ 代講の取り消しで担当でなくなった失効 (#291) も、
                        // 誰の判断でもないので赤字の「教室長より」にしない
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          代講が取り消され、このコマの担当ではなくなったため、欠勤の記録は不要になりました
                        </p>
                      ) : h.closedUnassigned ? (
                        // ⚠️ 「不要として閉じる」(#289) も赤字にしない。担当が
                        // 変わった (またはコマが無くなった) ことの説明で、
                        // 却下理由ではない。赤字の「教室長より」だと叱られた
                        // と読める (PR #290 のレビュー)
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          担当が変わったか、コマが無くなったため、この欠勤申請は不要になりました
                        </p>
                      ) : (
                        <p className="mt-0.5 text-sm text-destructive">
                          教室長より: {h.decisionNote}
                        </p>
                      ))}
                    {/* #331: 教室長が指定した代講の相手への依頼 */}
                    {h.designation.kind === "can-request" && (
                      <div className="mt-2 space-y-2 rounded-lg bg-accent/10 p-3">
                        <p className="text-sm">
                          教室長が代講の相手に{" "}
                          <span className="font-semibold">
                            {h.designatedName}さん
                          </span>{" "}
                          を指定しました。依頼してください。
                        </p>
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () =>
                                requestDesignatedSubstitute({ absenceId: h.id }),
                              `${h.designatedName}さんに代講を依頼しました。`,
                            )
                          }
                        >
                          {h.designatedName}さんに代講を依頼する
                        </Button>
                      </div>
                    )}
                    {h.designation.kind === "requested" && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        代講は教室長から{h.designatedName}
                        さんに依頼しています。返事を待っています。
                      </p>
                    )}
                    {h.designation.kind === "accepted" && (
                      <p className="mt-1 text-sm text-primary">
                        {h.designatedName}さんが代講を引き受けました。
                      </p>
                    )}
                    {h.designation.kind === "declined" && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {h.designatedName}
                        さんは都合がつきませんでした。教室長からの連絡を待ってください。
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

function Notice({
  notice,
}: {
  notice: { type: "ok" | "error"; text: string };
}) {
  return (
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
  );
}
