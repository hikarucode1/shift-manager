"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import type { RequestLogEntry } from "@/lib/request-log";
import type {
  LogPeriodFilter,
  LogStateFilter,
  LogTypeFilter,
  RequestLog,
} from "@/lib/request-log-query";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import { fmtDateTimeJst } from "@/lib/datetime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { cancelApprovedAbsence } from "./absence-actions";
import { cancelApprovedSwap } from "./swap-actions";

/**
 * 申請台帳 (#224)。承認済み・取り消し済み・却下を種別をまたいで 1 本で出す。
 *
 * ⚠️ **このコンポーネントは行の種類を判定しない。** 判定は
 * `src/lib/request-log.ts` に集約してテストで固定してある。ここで
 * `isProxy && …` のような分岐を足すと、行の種類が増えたときにまた嘘が出る
 * (#237 / #240 はそれで生まれた)。
 */
export function RequestLogPanel({
  log,
  period,
  type,
  state,
}: {
  log: RequestLog;
  period: LogPeriodFilter;
  type: LogTypeFilter;
  state: LogStateFilter;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  function setFilter(key: string, value: string) {
    const sp = new URLSearchParams({ tab: "log", period, type, state });
    sp.set(key, value);
    startTransition(() => router.replace(`/admin/requests?${sp.toString()}`));
  }

  function submit(entry: RequestLogEntry) {
    const trimmed = reason.trim();
    if (!trimmed) {
      setNotice({ type: "error", text: "取り消し理由を入力してください。" });
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const res = await (entry.kind === "absence"
        ? cancelApprovedAbsence({ id: entry.id, reason: trimmed })
        : cancelApprovedSwap({ id: entry.id, reason: trimmed })
      ).catch(toFailedResult);
      if (!res.ok) {
        setNotice({ type: "error", text: res.error });
        if (isIndeterminate(res)) router.refresh();
        return;
      }
      setNotice({ type: "ok", text: "取り消しました。" });
      setOpenId(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Select
          id="log-period"
          label="期間"
          value={period}
          onChange={(v) => setFilter("period", v)}
          options={[
            ["1m", "直近1ヶ月"],
            ["3m", "直近3ヶ月"],
            ["all", "すべて"],
          ]}
        />
        <Select
          id="log-type"
          label="種別"
          value={type}
          onChange={(v) => setFilter("type", v)}
          options={[
            ["all", "すべて"],
            ["absence", "欠勤"],
            ["swap", "交代・代講"],
          ]}
        />
        <Select
          id="log-state"
          label="状態"
          value={state}
          onChange={(v) => setFilter("state", v)}
          options={[
            ["all", "すべて"],
            ["approved", "承認済み"],
            ["cancelled", "取り消し済み"],
            ["rejected", "却下"],
          ]}
        />
      </div>

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

      {log.truncated && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          直近 {log.rows.length} 件のみ表示しています（これより前に決定したものは
          出ていません）。期間を絞ると古いものも探せます。
        </p>
      )}

      {log.rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            この条件に当てはまる記録はありません。
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {log.rows.map((r) => (
            <Card key={`${r.kind}-${r.id}`}>
              <CardContent className="space-y-2 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {fmtDateTimeJst(r.occurredAt)}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {r.kind === "absence" ? "欠勤" : "代講"}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {r.eventLabel}
                  </Badge>
                  {r.adminInitiated && (
                    <Badge variant="outline" className="text-[10px]">
                      教室長が起点
                    </Badge>
                  )}
                </div>

                <p className="font-medium">
                  {r.subjectName}
                  {r.substituteName && ` → ${r.substituteName}`}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {r.date}（{r.weekdayLabel}）{r.slotLabel}
                  </span>
                </p>

                <p className="text-xs text-muted-foreground">理由: {r.reason}</p>
                {r.actorName && (
                  <p className="text-xs text-muted-foreground">
                    操作: {r.actorName}
                  </p>
                )}
                {r.note && (
                  <p className="text-xs text-muted-foreground">
                    コメント: {r.note}
                  </p>
                )}

                {r.cancellable &&
                  (openId === `${r.kind}-${r.id}` ? (
                    <div className="space-y-2">
                      <label
                        className="block text-xs"
                        htmlFor={`cancel-${r.kind}-${r.id}`}
                      >
                        取り消し理由（必須）
                      </label>
                      <textarea
                        id={`cancel-${r.kind}-${r.id}`}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder="取り消しの理由を入力（講師に表示されます）"
                        className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isPending || !reason.trim()}
                          onClick={() => submit(r)}
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
                        setOpenId(`${r.kind}-${r.id}`);
                        setReason("");
                        setNotice(null);
                      }}
                    >
                      取り消す
                    </Button>
                  ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <span className="flex items-center gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border bg-background px-2 py-1 text-sm"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </span>
  );
}
