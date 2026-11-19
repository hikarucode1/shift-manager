"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toFailedResult } from "@/lib/action-failure";
import { undoWeekUpload } from "./undo-actions";

/**
 * 本番チェック メモ16: 取り込んで登録した座席表 (この週の分) を取り消す。
 * 間違えて登録したときのための操作。確認を出してから消す
 */
export function UndoWeekButton({
  weekStart,
  weekLabel,
  shiftCount,
}: {
  weekStart: string;
  /** 「11/23〜11/29」 */
  weekLabel: string;
  shiftCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { type: "ok"; text: string }
    | { type: "error"; text: string; blockers: string[] }
    | null
  >(null);

  function onClick() {
    const ok = window.confirm(
      `${weekLabel} の座席表の登録を取り消します。\n\n` +
        `この週の登録済みシフト ${shiftCount} コマと、生徒の割り当て、講師の「確認しました」がすべて消えます。講師には通知しません。\n\n` +
        `取り消しますか？`,
    );
    if (!ok) return;
    setResult(null);
    startTransition(async () => {
      const res = await undoWeekUpload({ weekStart }).catch(toFailedResult);
      if (res.ok) {
        // 取り消すとこのボタンごと消えるので、結果はページ側で出す
        router.push(`/admin/weekly?week=${weekStart}&undone=1`);
        router.refresh();
      } else {
        setResult({
          type: "error",
          text: res.error,
          blockers: "blockers" in res && res.blockers ? res.blockers : [],
        });
      }
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed px-4 py-3 text-sm print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="border-destructive/40 text-destructive hover:bg-destructive/5"
          disabled={pending}
          onClick={onClick}
        >
          <Undo2 className="mr-1 size-4" />
          この週の登録を取り消す
        </Button>
        <span className="text-xs text-muted-foreground">
          間違えて取り込んだときに使います。正しい座席表があるときは、取り込み直すだけで置き換わります。
        </span>
      </div>
      {result && (
        <div
          role={result.type === "error" ? "alert" : "status"}
          className={result.type === "ok" ? "text-primary" : "text-destructive"}
        >
          <p className="flex items-center gap-1">
            {result.type === "error" && <AlertCircle className="size-4 shrink-0" />}
            {result.text}
          </p>
          {result.type === "error" && result.blockers.length > 0 && (
            <ul className="mt-1 list-disc pl-6 text-xs">
              {result.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
