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
import {
  createPeriod,
  setPeriodArchived,
  setPeriodReopened,
  updatePeriod,
} from "./actions";

type Kind = "normal" | "training";

export type PeriodRow = {
  id: string;
  kind: Kind;
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

export function PeriodManager({ periods }: { periods: PeriodRow[] }) {
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

  // 新規作成フォーム
  const [kind, setKind] = useState<Kind>("training");
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
          kind,
          name: name.trim(),
          startDate: start,
          endDate: end,
          submissionDeadline: kind === "training" ? deadline : null,
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
          submissionDeadline: p.kind === "training" ? eDeadline : null,
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
            講習期間は提出締切日が必須です。通常期間に締切はありません。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
            onSubmit={handleCreate}
          >
            <div className="space-y-1">
              <Label htmlFor="p-kind">種別</Label>
              <select
                id="p-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="training">講習期間</option>
                <option value="normal">通常期間</option>
              </select>
            </div>
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
            {kind === "training" && (
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
            )}
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
          <div className="divide-y">
            {rows.map((p) => {
              const editing = editId === p.id;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:justify-between",
                    archivedView && "opacity-60",
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
                      {p.kind === "training" && (
                        <div className="space-y-1">
                          <Label className="text-xs">締切</Label>
                          <Input
                            type="date"
                            value={eDeadline}
                            onChange={(e) => setEDeadline(e.target.value)}
                            className="h-8 w-36"
                          />
                        </div>
                      )}
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
                        <Badge
                          variant={
                            p.kind === "training" ? "accent" : "secondary"
                          }
                        >
                          {p.kind === "training" ? "講習" : "通常"}
                        </Badge>
                        {p.isReopened && (
                          <Badge variant="destructive">締切無視中</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.startDate} 〜 {p.endDate}
                        {p.kind === "training" && p.submissionDeadline && (
                          <> ／ 締切 {fmtDeadline(p.submissionDeadline)}</>
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
                          {p.kind === "training" && (
                            <Button
                              size="sm"
                              variant={p.isReopened ? "destructive" : "outline"}
                              disabled={isPending}
                              title="締切を無視して講師の希望提出を受け付けます"
                              onClick={() => onReopen(p.id, !p.isReopened)}
                            >
                              {p.isReopened ? "締切で締める" : "締切後も受付"}
                            </Button>
                          )}
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
