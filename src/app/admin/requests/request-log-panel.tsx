"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Info } from "lucide-react";
import type { RequestLogEntry } from "@/lib/request-log";
import type { RequestLog } from "@/lib/request-log-query";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import { swapCancelNotice } from "@/lib/swap-cancel-notice";
import {
  LOG_PERIOD_LABELS,
  LOG_PERIODS,
  LOG_STATE_LABELS,
  LOG_STATE_FILTERS,
  LOG_TYPE_LABELS,
  LOG_TYPES,
  requestsHref,
  type LogPeriodFilter,
  type LogStateFilter,
  type LogTypeFilter,
  type RequestsFilters,
} from "@/lib/requests-search-params";
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

  function setFilter(patch: Partial<RequestsFilters>) {
    const next = { tab: "log" as const, period, type, state, ...patch };
    startTransition(() => router.replace(requestsHref(next)));
  }

  function submit(entry: RequestLogEntry) {
    const trimmed = reason.trim();
    if (!trimmed) {
      setNotice({ type: "error", text: "取り消し理由を入力してください。" });
      return;
    }
    setNotice(null);
    startTransition(async () => {
      // ⚠️ kind による分岐はここだけ。server action の宛先なので構造上不可避。
      // 成功時の文言も宛先ごとに決まるので、ここで一緒に作る
      const res = await (entry.kind === "absence"
        ? cancelApprovedAbsence({ id: entry.id, reason: trimmed }).then((r) =>
            r.ok ? { ok: true as const, text: "取り消しました。" } : r,
          )
        : cancelApprovedSwap({ id: entry.id, reason: trimmed }).then((r) =>
            // ⚠️ 交代の取り消しで同一コマの欠勤が自動失効していたら必ず伝える。
            // 黙って消すと、#217 で登録した欠勤が消えたことに気づけない (#225)。
            // 同じコマに元講師 (#283) や代講者 (#287) の募集が残っていれば、
            // それも伝える (両方のこともある)
            r.ok ? { ok: true as const, text: swapCancelNotice(r) } : r,
          )
      ).catch(toFailedResult);
      if (!res.ok) {
        setNotice({ type: "error", text: res.error });
        if (isIndeterminate(res)) router.refresh();
        return;
      }
      setNotice({ type: "ok", text: res.text });
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
          onChange={(v) => setFilter({ period: v })}
          options={LOG_PERIODS.map((v) => [v, LOG_PERIOD_LABELS[v]])}
        />
        <Select
          id="log-type"
          label="種別"
          value={type}
          onChange={(v) => setFilter({ type: v })}
          options={LOG_TYPES.map((v) => [v, LOG_TYPE_LABELS[v]])}
        />
        <Select
          id="log-state"
          label="状態"
          value={state}
          onChange={(v) => setFilter({ state: v })}
          options={LOG_STATE_FILTERS.map((v) => [v, LOG_STATE_LABELS[v]])}
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
          出ていません）。種別や状態で絞ると、隠れているものも探せます。
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
                    {r.kindLabel}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {r.eventLabel}
                  </Badge>
                  {r.adminInitiated && (
                    <Badge variant="outline" className="text-[10px]">
                      教室長が起点
                    </Badge>
                  )}
                  {/* #213: 実施済みかどうかは判断の前提。出していないと
                      「来週の予定の取り消し」と見た目で区別が付かない */}
                  {r.isEnded && (
                    <Badge variant="outline" className="text-[10px]">
                      実施済み
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
                      {/* 何が起きるかは種別で違う。文言はモデル側で固定してある */}
                      <p className="text-xs text-muted-foreground">
                        {r.cancelWarning}
                      </p>
                      {r.cancelHint && (
                        <p className="text-xs text-muted-foreground">
                          {r.cancelHint}
                        </p>
                      )}
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
                      {r.cancelLabel}
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

// 値の型は options から決まる。間違った候補値を書くと型エラーになる
function Select<V extends string>({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: [V, string][];
}) {
  return (
    <span className="flex items-center gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        // <select> は options に書いた値しか返さない
        onChange={(e) => onChange(e.target.value as V)}
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
