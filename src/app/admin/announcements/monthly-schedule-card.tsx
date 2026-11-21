"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, ExternalLink, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toFailedResult } from "@/lib/action-failure";
import { monthLabel, schedulePdfPath } from "@/lib/monthly-schedule";
import { cn } from "@/lib/utils";
import {
  removeMonthlySchedule,
  uploadMonthlySchedule,
} from "./schedule-actions";

type Row = { month: string; fileName: string; updatedAt: string };

/**
 * 室長レビュー要望12: 月のスケジュール (PDF) を上げる・確かめる・消す。
 * 上げると講師全員のベルとスマホに届く。同じ月をもう一度上げると置き換え
 */
export function MonthlyScheduleCard({
  rows,
  defaultMonth,
}: {
  rows: Row[];
  /** YYYY-MM (来月) */
  defaultMonth: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(defaultMonth);
  const [hasFile, setHasFile] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [result, setResult] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const replacing = rows.some((r) => r.month.slice(0, 7) === month);

  function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("month", month);
    fd.set("file", file);
    setResult(null);
    startTransition(async () => {
      const res = await uploadMonthlySchedule(fd).catch(toFailedResult);
      if (res.ok) {
        if (fileRef.current) fileRef.current.value = "";
        setHasFile(false);
        setResult({ type: "ok", text: res.message });
        router.refresh();
      } else {
        setResult({ type: "error", text: res.error });
      }
    });
  }

  function remove(m: string) {
    setResult(null);
    startTransition(async () => {
      const res = await removeMonthlySchedule({ month: m }).catch(
        toFailedResult,
      );
      setRemoving(null);
      setResult(
        res.ok
          ? { type: "ok", text: res.message }
          : { type: "error", text: res.error },
      );
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="ms-month">月</Label>
          <Input
            id="ms-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ms-file">PDF</Label>
          <Input
            id="ms-file"
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setHasFile(!!e.target.files?.length)}
          />
        </div>
        <Button
          type="button"
          onClick={upload}
          disabled={isPending || !hasFile || !month}
        >
          <Upload className="size-4" />
          {isPending ? "送信中..." : replacing ? "置き換える" : "アップロード"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        アップロードすると、講師全員に「{month ? monthLabel(`${month}-01`) : "〇月"}
        のスケジュールが{replacing ? "更新されました" : "出ました"}」と届きます。
      </p>

      {result && (
        <p
          role="status"
          className={cn(
            "flex items-center gap-1.5 text-sm",
            result.type === "ok" ? "text-green-700" : "text-destructive",
          )}
        >
          {result.type === "ok" ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <AlertCircle className="size-4" />
          )}
          {result.text}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y rounded-md border">
          {rows.map((r) => (
            <li
              key={r.month}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <span className="w-24 font-medium">{monthLabel(r.month)}</span>
              <a
                href={schedulePdfPath(r.month)}
                target="_blank"
                rel="noopener"
                className="flex min-w-0 flex-1 items-center gap-1 text-primary hover:underline"
              >
                <span className="truncate">{r.fileName}</span>
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
              {removing === r.month ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    講師の画面からも消えます
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isPending}
                    onClick={() => remove(r.month)}
                  >
                    消す
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => setRemoving(null)}
                  >
                    やめる
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => setRemoving(r.month)}
                >
                  削除
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
