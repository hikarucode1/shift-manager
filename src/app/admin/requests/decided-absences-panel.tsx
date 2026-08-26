"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import type { AbsenceHistory } from "@/lib/absences";
import { Badge } from "@/components/ui/badge";
import { toFailedResult, isIndeterminate } from "@/lib/action-failure";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDateTimeJst } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { cancelApprovedAbsence } from "./absence-actions";

/**
 * 承認済みの欠勤と、その取り消し (#219)。
 *
 * これが無いと `approved` は終端で、誤承認した欠勤の取り消し線が週次シフト表から
 * 消せなかった。`ApprovedSwapsPanel` (#213) と対称だが、欠勤は `weekly_shifts` を
 * 触らない (status を戻せば表示も戻る) ぶん単純。
 */
export function DecidedAbsencesPanel({
  history,
  readOnly = false,
}: {
  history: AbsenceHistory;
  /** 取り消し済みタブ。閲覧のみ (理由が write-only にならないように) */
  readOnly?: boolean;
}) {
  const rows = history.rows;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  function submit(id: string) {
    const trimmed = reason.trim();
    if (!trimmed) {
      setNotice({ type: "error", text: "取り消し理由を入力してください。" });
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const res = await cancelApprovedAbsence({ id, reason: trimmed }).catch(
        toFailedResult,
      );
      if (!res.ok) {
        setNotice({ type: "error", text: res.error });
        if (isIndeterminate(res)) router.refresh();
        return;
      }
      setNotice({
        type: "ok",
        text: "取り消しました。週次シフト表の欠勤表示も戻ります。",
      });
      setOpenId(null);
      setReason("");
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {readOnly
            ? "取り消した欠勤はありません。"
            : "承認済みの欠勤はありません。"}
        </CardContent>
      </Card>
    );
  }

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
          {notice.type === "error" && <AlertCircle className="size-4" />}
          {notice.text}
        </p>
      )}

      {!readOnly && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          取り消すと、週次シフト表からこのコマの欠勤表示が消えます。実際に休んだ場合は
          取り消さないでください（表が実態と食い違います）。
        </p>
      )}

      {history.truncated > 0 && (
        <p className="text-xs text-muted-foreground">
          直近 {rows.length} 件のみ表示しています（これより前に決定した
          ものは出ていません）。
        </p>
      )}

      {rows.map((r) => (
        <Card key={r.id}>
          <CardContent className="space-y-2 p-4 text-sm">
            {/* Badge は <div> を返すので <p> に入れると hydration が壊れる */}
            <div className="flex items-center gap-2 font-medium">
              <span>
                {r.date}（{r.weekdayLabel}）{r.slotLabel}
              </span>
              {r.isEnded && (
                <Badge variant="outline" className="text-[10px]">
                  実施済み
                </Badge>
              )}
              {/* #217: 本人申告か代理登録かは created_by でしか分からない */}
              {r.isProxy && (
                <Badge variant="secondary" className="text-[10px]">
                  代理登録
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">{r.tutorName}</p>
            <p className="text-xs text-muted-foreground">理由: {r.reason}</p>
            {/* #225: 自動失効 (交代成立) は decided_by を null にするので、
                名前が無い = 「誰でもない決定」。理由は decisionNote に出る */}
            {(r.decidedByName || r.decidedAt) && (
              <p className="text-xs text-muted-foreground">
                {readOnly ? "取り消し" : "承認"}
                {r.decidedByName ? `: ${r.decidedByName}` : ""}
                {r.decidedAt ? `（${fmtDateTimeJst(r.decidedAt)}）` : ""}
              </p>
            )}
            {readOnly && r.decisionNote && (
              <p className="text-xs text-muted-foreground">
                取り消し理由: {r.decisionNote}
              </p>
            )}

            {readOnly ? null : openId === r.id ? (
              <div className="space-y-2">
                <label className="block text-xs" htmlFor={`cancel-abs-${r.id}`}>
                  取り消し理由（必須）
                </label>
                <textarea
                  id={`cancel-abs-${r.id}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="取り消しの理由を入力（講師に表示されます）"
                  className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                />
                {/* #217 で「代理で欠勤を登録する」が入り、過去日でも登録し直せる
                    ようになった。詰みではなくなったので destructive をやめる。
                    ただし講師側の createAbsenceRequest は今も過去日を弾く */}
                {r.isPastDate && (
                  <p className="text-xs text-muted-foreground">
                    このコマは過去日のため、講師は自分で登録し直せません。必要なら
                    「代理で欠勤を登録する」から登録してください。
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isPending || !reason.trim()}
                    onClick={() => submit(r.id)}
                  >
                    取り消す
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => {
                      setOpenId(null);
                      setReason("");
                    }}
                  >
                    やめる
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setOpenId(r.id);
                  setReason("");
                  setNotice(null);
                }}
              >
                この欠勤を取り消す
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
