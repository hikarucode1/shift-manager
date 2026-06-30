"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarPlus, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ACCENT_BADGE, GREEN_BADGE, MUTED_BADGE } from "@/lib/period-status";
import {
  createPeriod,
  setPeriodArchived,
  setPeriodReopened,
  updatePeriod,
} from "./actions";

export type PeriodRow = {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  submissionDeadline: string | null; // ISO (UTC)
  isReopened: boolean;
  isArchived: boolean;
};

/** ISO(UTC) → JST のカレンダー日付 YYYY-MM-DD (締切は 23:59:59 JST 保存) */
function jstDateOf(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

type PeriodStatus = {
  label: "開始前" | "進行中" | "終了";
  className: string;
};

/**
 * JST 現在日 (today) と期間の開始・終了日から進行状況を判定。
 * すべて "YYYY-MM-DD" なので辞書順比較 = 日付順比較。期間は両端含む。
 * today は page.tsx (server) で確定させ SSR/hydration のズレを防ぐ。
 * 配色は UI 刷新デザイン (進行中=緑 / 開始前=muted / 終了=muted) に準拠。
 */
function periodStatus(today: string, start: string, end: string): PeriodStatus {
  if (today < start) return { label: "開始前", className: MUTED_BADGE };
  if (today > end) return { label: "終了", className: MUTED_BADGE };
  return { label: "進行中", className: GREEN_BADGE };
}

/**
 * 提出締切を過ぎたかどうか。締切は 23:59:59 JST 保存なので、JST 日付 (today)
 * と締切の JST 日付を辞書順比較すれば足りる。締切日当日までは「受付中」。
 */
function deadlineStatus(
  today: string,
  deadlineIso: string,
): { label: "受付中" | "締切済"; className: string } {
  const open = today <= jstDateOf(deadlineIso);
  return open
    ? { label: "受付中", className: ACCENT_BADGE }
    : { label: "締切済", className: MUTED_BADGE };
}

export function PeriodManager({
  periods,
  today,
}: {
  periods: PeriodRow[];
  today: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  // 新規作成フォーム (#110 で kind 撤廃、全期間が講習期間)
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [deadline, setDeadline] = useState("");

  // 編集
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eStart, setEStart] = useState("");
  const [eEnd, setEEnd] = useState("");
  const [eDeadline, setEDeadline] = useState("");

  const { active, archived } = useMemo(() => {
    return {
      active: periods.filter((p) => !p.isArchived),
      archived: periods.filter((p) => p.isArchived),
    };
  }, [periods]);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
    onSuccess?: () => void,
  ) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setNotice({ type: "ok", text: okMsg });
        onSuccess?.();
        router.refresh();
      } else {
        setNotice({ type: "error", text: res.error ?? "失敗しました。" });
      }
    });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        createPeriod({
          name: name.trim(),
          startDate: start,
          endDate: end,
          submissionDeadline: deadline,
        }),
      "期間を作成しました。",
      () => {
        setName("");
        setStart("");
        setEnd("");
        setDeadline("");
      },
    );
  }

  function startEdit(p: PeriodRow) {
    setEditId(p.id);
    setEName(p.name);
    setEStart(p.startDate);
    setEEnd(p.endDate);
    setEDeadline(p.submissionDeadline ? jstDateOf(p.submissionDeadline) : "");
  }

  function handleUpdate(p: PeriodRow) {
    run(
      () =>
        updatePeriod({
          id: p.id,
          name: eName.trim(),
          startDate: eStart,
          endDate: eEnd,
          submissionDeadline: eDeadline,
        }),
      "期間を更新しました。",
      () => setEditId(null),
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

      {/* 新規作成 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarPlus className="size-4" />
            期間を作成
          </CardTitle>
          <CardDescription>
            講習期間と提出締切日を設定します。提出締切日は必須です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
            onSubmit={handleCreate}
          >
            <div className="space-y-1 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="p-name">名称</Label>
              <Input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="2026年 夏期講習"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-start">開始日</Label>
              <Input
                id="p-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-end">終了日</Label>
              <Input
                id="p-end"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-deadline">提出締切日</Label>
              <Input
                id="p-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
              />
            </div>
            <Button
              type="submit"
              disabled={isPending}
              className="lg:col-span-1"
            >
              {isPending ? "作成中..." : "作成"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <PeriodList
        title="期間一覧"
        rows={active}
        today={today}
        emptyText="期間がまだ登録されていません。"
        isPending={isPending}
        editId={editId}
        eName={eName}
        eStart={eStart}
        eEnd={eEnd}
        eDeadline={eDeadline}
        setEName={setEName}
        setEStart={setEStart}
        setEEnd={setEEnd}
        setEDeadline={setEDeadline}
        onStartEdit={startEdit}
        onCancelEdit={() => setEditId(null)}
        onUpdate={handleUpdate}
        onArchive={(id, value) =>
          run(
            () => setPeriodArchived({ id, value }),
            value ? "アーカイブしました。" : "復帰しました。",
          )
        }
        onReopen={(id, value) =>
          run(
            () => setPeriodReopened({ id, value }),
            value ? "締切後の提出を再開放しました。" : "再開放を解除しました。",
          )
        }
      />

      {archived.length > 0 && (
        <PeriodList
          title="アーカイブ済み"
          rows={archived}
          today={today}
          emptyText=""
          isPending={isPending}
          editId={null}
          eName=""
          eStart=""
          eEnd=""
          eDeadline=""
          setEName={() => {}}
          setEStart={() => {}}
          setEEnd={() => {}}
          setEDeadline={() => {}}
          onStartEdit={() => {}}
          onCancelEdit={() => {}}
          onUpdate={() => {}}
          onArchive={(id, value) =>
            run(
              () => setPeriodArchived({ id, value }),
              value ? "アーカイブしました。" : "復帰しました。",
            )
          }
          onReopen={() => {}}
          archivedView
        />
      )}
    </div>
  );
}

function fmtDeadline(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
  });
}

function PeriodList({
  title,
  rows,
  today,
  emptyText,
  isPending,
  editId,
  eName,
  eStart,
  eEnd,
  eDeadline,
  setEName,
  setEStart,
  setEEnd,
  setEDeadline,
  onStartEdit,
  onCancelEdit,
  onUpdate,
  onArchive,
  onReopen,
  archivedView = false,
}: {
  title: string;
  rows: PeriodRow[];
  today: string;
  emptyText: string;
  isPending: boolean;
  editId: string | null;
  eName: string;
  eStart: string;
  eEnd: string;
  eDeadline: string;
  setEName: (v: string) => void;
  setEStart: (v: string) => void;
  setEEnd: (v: string) => void;
  setEDeadline: (v: string) => void;
  onStartEdit: (p: PeriodRow) => void;
  onCancelEdit: () => void;
  onUpdate: (p: PeriodRow) => void;
  onArchive: (id: string, value: boolean) => void;
  onReopen: (id: string, value: boolean) => void;
  archivedView?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title}
          <Badge variant="secondary" className="ml-2">
            {rows.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {emptyText}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((p) => {
              const editing = editId === p.id;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border border-l-[3px] border-l-accent p-3.5 lg:flex-row lg:items-center lg:justify-between",
                    editing && "sm:col-span-2",
                    archivedView && "border-l-muted-foreground/30 opacity-60",
                  )}
                >
                  {editing ? (
                    <div className="flex flex-1 flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">名称</Label>
                        <Input
                          value={eName}
                          onChange={(e) => setEName(e.target.value)}
                          className="h-8 w-44"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">開始</Label>
                        <Input
                          type="date"
                          value={eStart}
                          onChange={(e) => setEStart(e.target.value)}
                          className="h-8 w-36"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">終了</Label>
                        <Input
                          type="date"
                          value={eEnd}
                          onChange={(e) => setEEnd(e.target.value)}
                          className="h-8 w-36"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">締切</Label>
                        <Input
                          type="date"
                          value={eDeadline}
                          onChange={(e) => setEDeadline(e.target.value)}
                          className="h-8 w-36"
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() => onUpdate(p)}
                      >
                        保存
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label="キャンセル"
                        onClick={onCancelEdit}
                      >
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {(() => {
                          const s = periodStatus(
                            today,
                            p.startDate,
                            p.endDate,
                          );
                          return (
                            <Badge className={s.className}>{s.label}</Badge>
                          );
                        })()}
                        {/* 締切バッジは再開放中は出さない。締切後でも受付中なので
                            「締切済」表示が「締切無視中」と矛盾するのを避ける (#126 review)。*/}
                        {!archivedView &&
                          p.submissionDeadline &&
                          !p.isReopened &&
                          (() => {
                            const d = deadlineStatus(
                              today,
                              p.submissionDeadline,
                            );
                            return (
                              <Badge className={d.className}>{d.label}</Badge>
                            );
                          })()}
                        {p.isReopened && (
                          <Badge variant="destructive">締切無視中</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.startDate} 〜 {p.endDate}
                        {p.submissionDeadline && (
                          <>
                            {" ／ 締切 "}
                            <span className="font-medium text-accent">
                              {fmtDeadline(p.submissionDeadline)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {!editing && (
                    <div className="flex flex-wrap items-center gap-2">
                      {!archivedView && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label="編集"
                            disabled={isPending}
                            onClick={() => onStartEdit(p)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant={p.isReopened ? "destructive" : "outline"}
                            disabled={isPending}
                            title="締切を無視して講師の希望提出を受け付けます"
                            onClick={() => onReopen(p.id, !p.isReopened)}
                          >
                            {p.isReopened ? "締切で締める" : "締切後も受付"}
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant={archivedView ? "default" : "outline"}
                        disabled={isPending}
                        onClick={() => onArchive(p.id, !p.isArchived)}
                      >
                        {archivedView ? "復帰" : "アーカイブ"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
