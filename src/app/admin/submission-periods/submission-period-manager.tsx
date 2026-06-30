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
  createSubmissionPeriod,
  setSubmissionPeriodArchived,
  updateSubmissionPeriod,
} from "./actions";

export type SubmissionPeriodRow = {
  id: string;
  targetMonth: string; // YYYY-MM-DD (月の1日)
  submissionOpensAt: string; // ISO (UTC)
  submissionDueAt: string;
  isArchived: boolean;
};

type SubmissionStatus = {
  label: "開始前" | "受付中" | "締切後";
  /** 受付中のみ accent 強調。配色は UI 刷新デザインに準拠。 */
  active: boolean;
  className: string;
};

const MUTED_BADGE =
  "border-transparent bg-muted text-muted-foreground hover:bg-muted";
const ACCENT_BADGE =
  "border-transparent bg-accent/15 text-accent hover:bg-accent/15";

function submissionStatus(
  nowIso: string,
  opensAt: string,
  dueAt: string,
): SubmissionStatus {
  const now = Date.parse(nowIso);
  if (now < Date.parse(opensAt))
    return { label: "開始前", active: false, className: MUTED_BADGE };
  if (now > Date.parse(dueAt))
    return { label: "締切後", active: false, className: MUTED_BADGE };
  return { label: "受付中", active: true, className: ACCENT_BADGE };
}

function fmtMonth(iso: string): string {
  const [y, m] = iso.split("-");
  return `${Number(y)}年${Number(m)}月分`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO(UTC) → datetime-local 用 "YYYY-MM-DDTHH:mm" (JST) */
function toLocalInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

/** datetime-local input ("YYYY-MM-DDTHH:mm") は JST 想定で ISO に戻す */
function fromLocalInput(local: string): string {
  if (!local) return "";
  return new Date(`${local}:00+09:00`).toISOString();
}

export function SubmissionPeriodManager({
  periods,
  now,
}: {
  periods: SubmissionPeriodRow[];
  now: string;
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

  // 新規作成
  const [targetMonth, setTargetMonth] = useState("");
  const [opens, setOpens] = useState("");
  const [due, setDue] = useState("");

  // 編集
  const [editId, setEditId] = useState<string | null>(null);
  const [eOpens, setEOpens] = useState("");
  const [eDue, setEDue] = useState("");

  const { active, archived } = useMemo(
    () => ({
      active: periods.filter((p) => !p.isArchived),
      archived: periods.filter((p) => p.isArchived),
    }),
    [periods],
  );

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
    // month input "YYYY-MM" → "YYYY-MM-01"
    const targetIso = targetMonth ? `${targetMonth}-01` : "";
    run(
      () =>
        createSubmissionPeriod({
          targetMonth: targetIso,
          submissionOpensAt: fromLocalInput(opens),
          submissionDueAt: fromLocalInput(due),
        }),
      "提出期間を作成しました。",
      () => {
        setTargetMonth("");
        setOpens("");
        setDue("");
      },
    );
  }

  function startEdit(p: SubmissionPeriodRow) {
    setEditId(p.id);
    setEOpens(toLocalInput(p.submissionOpensAt));
    setEDue(toLocalInput(p.submissionDueAt));
  }

  function handleUpdate(p: SubmissionPeriodRow) {
    run(
      () =>
        updateSubmissionPeriod({
          id: p.id,
          submissionOpensAt: fromLocalInput(eOpens),
          submissionDueAt: fromLocalInput(eDue),
        }),
      "提出期間を更新しました。",
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarPlus className="size-4" />
            提出期間を作成
          </CardTitle>
          <CardDescription>
            対象月ごとに 1 件作成できます。同じ対象月の重複は作れません。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
            onSubmit={handleCreate}
          >
            <div className="space-y-1">
              <Label htmlFor="sp-month">対象月</Label>
              <Input
                id="sp-month"
                type="month"
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-opens">提出開始 (JST)</Label>
              <Input
                id="sp-opens"
                type="datetime-local"
                value={opens}
                onChange={(e) => setOpens(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-due">提出締切 (JST)</Label>
              <Input
                id="sp-due"
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "作成中..." : "作成"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <PeriodList
        title="提出期間一覧"
        rows={active}
        now={now}
        emptyText="提出期間がまだ登録されていません。"
        isPending={isPending}
        editId={editId}
        eOpens={eOpens}
        eDue={eDue}
        setEOpens={setEOpens}
        setEDue={setEDue}
        onStartEdit={startEdit}
        onCancelEdit={() => setEditId(null)}
        onUpdate={handleUpdate}
        onArchive={(id, value) =>
          run(
            () => setSubmissionPeriodArchived({ id, value }),
            value ? "アーカイブしました。" : "復帰しました。",
          )
        }
      />

      {archived.length > 0 && (
        <PeriodList
          title="アーカイブ済み"
          rows={archived}
          now={now}
          emptyText=""
          isPending={isPending}
          editId={null}
          eOpens=""
          eDue=""
          setEOpens={() => {}}
          setEDue={() => {}}
          onStartEdit={() => {}}
          onCancelEdit={() => {}}
          onUpdate={() => {}}
          onArchive={(id, value) =>
            run(
              () => setSubmissionPeriodArchived({ id, value }),
              value ? "アーカイブしました。" : "復帰しました。",
            )
          }
          archivedView
        />
      )}
    </div>
  );
}

function PeriodList({
  title,
  rows,
  now,
  emptyText,
  isPending,
  editId,
  eOpens,
  eDue,
  setEOpens,
  setEDue,
  onStartEdit,
  onCancelEdit,
  onUpdate,
  onArchive,
  archivedView = false,
}: {
  title: string;
  rows: SubmissionPeriodRow[];
  now: string;
  emptyText: string;
  isPending: boolean;
  editId: string | null;
  eOpens: string;
  eDue: string;
  setEOpens: (v: string) => void;
  setEDue: (v: string) => void;
  onStartEdit: (p: SubmissionPeriodRow) => void;
  onCancelEdit: () => void;
  onUpdate: (p: SubmissionPeriodRow) => void;
  onArchive: (id: string, value: boolean) => void;
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
              const status = submissionStatus(
                now,
                p.submissionOpensAt,
                p.submissionDueAt,
              );
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border border-l-[3px] p-3.5 lg:flex-row lg:items-center lg:justify-between",
                    editing && "sm:col-span-2",
                    !archivedView && status.active
                      ? "border-l-accent"
                      : "border-l-muted-foreground/30",
                    archivedView && "opacity-60",
                  )}
                >
                  {editing ? (
                    <div className="flex flex-1 flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">対象月</Label>
                        <Input
                          value={fmtMonth(p.targetMonth)}
                          disabled
                          className="h-8 w-40 disabled:opacity-100"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">提出開始</Label>
                        <Input
                          type="datetime-local"
                          value={eOpens}
                          onChange={(e) => setEOpens(e.target.value)}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">提出締切</Label>
                        <Input
                          type="datetime-local"
                          value={eDue}
                          onChange={(e) => setEDue(e.target.value)}
                          className="h-8"
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
                        <span className="font-medium">
                          {fmtMonth(p.targetMonth)}
                        </span>
                        <Badge className={status.className}>
                          {status.label}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        受付 {fmtDateTime(p.submissionOpensAt)} 〜 締切{" "}
                        <span className="font-medium text-accent">
                          {fmtDateTime(p.submissionDueAt)}
                        </span>
                      </div>
                    </div>
                  )}

                  {!editing && (
                    <div className="flex flex-wrap items-center gap-2">
                      {!archivedView && (
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
