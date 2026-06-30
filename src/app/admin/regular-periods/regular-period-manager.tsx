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
  createRegularPeriod,
  setRegularPeriodArchived,
  updateRegularPeriod,
} from "./actions";

export type RegularPeriodRow = {
  id: string;
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  submissionOpensAt: string; // ISO (UTC)
  submissionDueAt: string; // ISO (UTC)
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

/** "2026-04-01" → "2026/04/01" */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}/${m}/${d}`;
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

export function RegularPeriodManager({
  periods,
  now,
}: {
  periods: RegularPeriodRow[];
  now: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  // Issue #82 (2): SSR で焼き付けた `now` を 1 分ごとにクライアント側で更新する。
  // admin が画面を開きっぱなしでも submissionStatus バッジ (開始前 / 受付中 / 締切後)
  // が境界跨ぎでリアルタイムに切り替わる。router.refresh まで待たせない。
  const [nowClient, setNowClient] = useState(now);
  useEffect(() => {
    const id = setInterval(
      () => setNowClient(new Date().toISOString()),
      60_000,
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  // 新規作成
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [opens, setOpens] = useState("");
  const [due, setDue] = useState("");

  // 編集
  const [editId, setEditId] = useState<string | null>(null);
  const [eLabel, setELabel] = useState("");
  const [eStart, setEStart] = useState("");
  const [eEnd, setEEnd] = useState("");
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
    run(
      () =>
        createRegularPeriod({
          label,
          startDate,
          endDate,
          submissionOpensAt: fromLocalInput(opens),
          submissionDueAt: fromLocalInput(due),
        }),
      "期を作成しました。",
      () => {
        setLabel("");
        setStartDate("");
        setEndDate("");
        setOpens("");
        setDue("");
      },
    );
  }

  function startEdit(p: RegularPeriodRow) {
    setEditId(p.id);
    setELabel(p.label);
    setEStart(p.startDate);
    setEEnd(p.endDate);
    setEOpens(toLocalInput(p.submissionOpensAt));
    setEDue(toLocalInput(p.submissionDueAt));
  }

  function handleUpdate(p: RegularPeriodRow) {
    run(
      () =>
        updateRegularPeriod({
          id: p.id,
          label: eLabel,
          startDate: eStart,
          endDate: eEnd,
          submissionOpensAt: fromLocalInput(eOpens),
          submissionDueAt: fromLocalInput(eDue),
        }),
      "期を更新しました。",
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
            期を作成
          </CardTitle>
          <CardDescription>
            期の長さは可変です。ラベル (例: 2026年春期 (4-6月))、開始日、終了日、
            提出開始 / 締切日時を指定してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:items-end"
            onSubmit={handleCreate}
          >
            <div className="space-y-1 lg:col-span-3">
              <Label htmlFor="rp-label">ラベル</Label>
              <Input
                id="rp-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="2026年春期 (4-6月)"
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp-start">期の開始日</Label>
              <Input
                id="rp-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp-end">期の終了日</Label>
              <Input
                id="rp-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
            <div className="hidden lg:block" />
            <div className="space-y-1">
              <Label htmlFor="rp-opens">提出開始 (JST)</Label>
              <Input
                id="rp-opens"
                type="datetime-local"
                value={opens}
                onChange={(e) => setOpens(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp-due">提出締切 (JST)</Label>
              <Input
                id="rp-due"
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
        title="期一覧"
        rows={active}
        now={nowClient}
        emptyText="期がまだ登録されていません。"
        isPending={isPending}
        editing={{
          editId,
          eLabel,
          eStart,
          eEnd,
          eOpens,
          eDue,
          setELabel,
          setEStart,
          setEEnd,
          setEOpens,
          setEDue,
          onStartEdit: startEdit,
          onCancelEdit: () => setEditId(null),
          onUpdate: handleUpdate,
        }}
        onArchive={(id, value) =>
          run(
            () => setRegularPeriodArchived({ id, value }),
            value ? "アーカイブしました。" : "復帰しました。",
          )
        }
      />

      {archived.length > 0 && (
        <PeriodList
          title="アーカイブ済み"
          rows={archived}
          now={nowClient}
          emptyText=""
          isPending={isPending}
          onArchive={(id, value) =>
            run(
              () => setRegularPeriodArchived({ id, value }),
              value ? "アーカイブしました。" : "復帰しました。",
            )
          }
          archivedView
        />
      )}
    </div>
  );
}

/** 行内編集 UI 一式。read-only な一覧 (アーカイブ済み) では渡さない。 */
type PeriodEditing = {
  editId: string | null;
  eLabel: string;
  eStart: string;
  eEnd: string;
  eOpens: string;
  eDue: string;
  setELabel: (v: string) => void;
  setEStart: (v: string) => void;
  setEEnd: (v: string) => void;
  setEOpens: (v: string) => void;
  setEDue: (v: string) => void;
  onStartEdit: (p: RegularPeriodRow) => void;
  onCancelEdit: () => void;
  onUpdate: (p: RegularPeriodRow) => void;
};

function PeriodList({
  title,
  rows,
  now,
  emptyText,
  isPending,
  editing,
  onArchive,
  archivedView = false,
}: {
  title: string;
  rows: RegularPeriodRow[];
  now: string;
  emptyText: string;
  isPending: boolean;
  editing?: PeriodEditing;
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
              const rowEditing =
                editing && editing.editId === p.id ? editing : null;
              const status = submissionStatus(
                now,
                p.submissionOpensAt,
                p.submissionDueAt,
              );
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border border-l-[3px] p-3.5 lg:flex-row lg:items-start lg:justify-between",
                    rowEditing && "sm:col-span-2",
                    !archivedView && status.active
                      ? "border-l-accent"
                      : "border-l-muted-foreground/30",
                    archivedView && "opacity-60",
                  )}
                >
                  {rowEditing ? (
                    <div className="flex flex-1 flex-col gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">ラベル</Label>
                        <Input
                          value={rowEditing.eLabel}
                          onChange={(e) => rowEditing.setELabel(e.target.value)}
                          maxLength={100}
                          className="h-8"
                        />
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">開始日</Label>
                          <Input
                            type="date"
                            value={rowEditing.eStart}
                            onChange={(e) =>
                              rowEditing.setEStart(e.target.value)
                            }
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">終了日</Label>
                          <Input
                            type="date"
                            value={rowEditing.eEnd}
                            onChange={(e) => rowEditing.setEEnd(e.target.value)}
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">提出開始</Label>
                          <Input
                            type="datetime-local"
                            value={rowEditing.eOpens}
                            onChange={(e) =>
                              rowEditing.setEOpens(e.target.value)
                            }
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">提出締切</Label>
                          <Input
                            type="datetime-local"
                            value={rowEditing.eDue}
                            onChange={(e) => rowEditing.setEDue(e.target.value)}
                            className="h-8"
                          />
                        </div>
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() => rowEditing.onUpdate(p)}
                        >
                          保存
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="キャンセル"
                          onClick={rowEditing.onCancelEdit}
                        >
                          <X />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{p.label}</span>
                        <Badge className={status.className}>
                          {status.label}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        期間 {fmtDate(p.startDate)} 〜 {fmtDate(p.endDate)}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        受付 {fmtDateTime(p.submissionOpensAt)} 〜 締切{" "}
                        <span className="font-medium text-accent">
                          {fmtDateTime(p.submissionDueAt)}
                        </span>
                      </div>
                    </div>
                  )}

                  {!rowEditing && (
                    <div className="flex flex-wrap items-center gap-2">
                      {editing && !archivedView && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="編集"
                          disabled={isPending}
                          onClick={() => editing.onStartEdit(p)}
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
