"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import type { AbsenceRequestRow, UpcomingShift } from "@/lib/absences";
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

const STATUS_LABEL: Record<
  AbsenceRequestRow["status"],
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
  history: AbsenceRequestRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  const [target, setTarget] = useState("");
  const [category, setCategory] =
    useState<(typeof REASON_CATEGORIES)[number] | "">("");
  const [memo, setMemo] = useState("");

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
    const sel = upcoming.find(
      (u) => `${u.date}|${u.slotNumber}` === target,
    );
    if (!sel) {
      setNotice({ type: "error", text: "対象のコマを選択してください。" });
      return;
    }
    if (!category) {
      setNotice({ type: "error", text: "理由区分を選択してください。" });
      return;
    }
    const trimmed = memo.trim();
    if (category === "その他" && !trimmed) {
      setNotice({
        type: "error",
        text: "「その他」を選んだ場合は詳細メモを入力してください。",
      });
      return;
    }
    // backend は単一の reason 文字列のみ受け付ける (無改修) ため区分＋メモを合成
    const reason = trimmed ? `${category}（${trimmed}）` : category;
    run(
      () =>
        createAbsenceRequest({
          date: sel.date,
          slotNumber: sel.slotNumber,
          reason,
        }),
      "欠勤申請を送信しました。",
      () => {
        setTarget("");
        setCategory("");
        setMemo("");
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
          <CardTitle className="text-base">新しい欠勤申請</CardTitle>
          <CardDescription>
            申請できるのは今日以降の自分の確定シフトです。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              申請できる今後のシフトがありません。
            </p>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              {/* 1. 対象シフト選択 (選択中=primary 地) */}
              <div className="space-y-2">
                <Label>対象のシフト</Label>
                <div className="space-y-2">
                  {upcoming.map((u) => {
                    const val = `${u.date}|${u.slotNumber}`;
                    const on = target === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setTarget(val)}
                        aria-pressed={on}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted",
                        )}
                      >
                        <span className="text-sm font-medium">
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
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. 理由区分チップ (選択中=primary 地) */}
              <div className="space-y-2">
                <Label>理由</Label>
                <div className="flex flex-wrap gap-2">
                  {REASON_CATEGORIES.map((c) => {
                    const on = category === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCategory(c)}
                        aria-pressed={on}
                        className={cn(
                          "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted",
                        )}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>

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

              {/* 5. 下部 primary 全幅 */}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? "送信中..." : "欠勤を申請"}
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
                const st = STATUS_LABEL[h.status];
                return (
                  <div key={h.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {shortDate(h.date)}（{h.weekdayLabel}） {h.slotLabel}
                      </span>
                      <Badge variant={st.variant}>{st.text}</Badge>
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
                    {h.decisionNote && (
                      <p className="mt-0.5 text-sm text-destructive">
                        教室長より: {h.decisionNote}
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
