"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, UploadCloud } from "lucide-react";
import type { ParsedShiftCsv } from "@/lib/shift-csv-parser";
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
import { WEEKDAYS } from "@/lib/shift-constants";
import { cn } from "@/lib/utils";
import { commitUploadedCsv, parseUploadedCsv } from "./actions";

type Tutor = { id: string; displayName: string };
type Mappings = Record<string, string>; // teacherName -> tutorId or ""

type Stage = "idle" | "parsed" | "done";

type ParsedBundle = {
  parsed: ParsedShiftCsv;
  rawContent: string;
  originalFilename: string;
  fileBytes: number;
};

export function UploadWizard({ tutors }: { tutors: Tutor[] }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [bundle, setBundle] = useState<ParsedBundle | null>(null);
  const [mappings, setMappings] = useState<Mappings>({});
  const [isParsePending, startParse] = useTransition();
  const [isCommitPending, startCommit] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    | {
        insertedShiftRows: number;
        insertedAssignmentRows: number;
        upsertedStudents: number;
      }
    | null
  >(null);

  function reset() {
    setStage("idle");
    setFile(null);
    setBundle(null);
    setMappings({});
    setError(null);
    setResult(null);
  }

  function handleParse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("ファイルを選択してください。");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    startParse(async () => {
      const res = await parseUploadedCsv(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Auto-map by exact display_name match
      const auto: Mappings = {};
      for (const name of res.parsed.uniqueTeacherNames) {
        const found = tutors.find((t) => t.displayName === name);
        auto[name] = found?.id ?? "";
      }
      setBundle({
        parsed: res.parsed,
        rawContent: res.rawContent,
        originalFilename: res.originalFilename,
        fileBytes: res.fileBytes,
      });
      setMappings(auto);
      setStage("parsed");
    });
  }

  function handleCommit() {
    if (!bundle) return;
    setError(null);
    const missing = bundle.parsed.uniqueTeacherNames.filter((n) => !mappings[n]);
    if (missing.length > 0) {
      setError(`未対応の講師があります: ${missing.join(", ")}`);
      return;
    }
    startCommit(async () => {
      const res = await commitUploadedCsv({
        parsed: bundle.parsed,
        rawContent: bundle.rawContent,
        originalFilename: bundle.originalFilename,
        fileBytes: bundle.fileBytes,
        mappings,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({
        insertedShiftRows: res.insertedShiftRows,
        insertedAssignmentRows: res.insertedAssignmentRows,
        upsertedStudents: res.upsertedStudents,
      });
      setStage("done");
      router.refresh();
    });
  }

  /* ------------------------------ render ----------------------------- */

  if (stage === "done" && result && bundle) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="text-primary" />
            公開しました
          </CardTitle>
          <CardDescription>
            {bundle.parsed.weekStart} 〜 {bundle.parsed.weekEnd} のシフトを反映
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Stat label="シフト" value={result.insertedShiftRows} suffix="件" />
            <Stat
              label="生徒割当"
              value={result.insertedAssignmentRows}
              suffix="件"
            />
            <Stat
              label="新規生徒"
              value={result.upsertedStudents}
              suffix="名"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={reset}>もう1週分アップロード</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (stage === "parsed" && bundle) {
    return (
      <PreviewStage
        bundle={bundle}
        tutors={tutors}
        mappings={mappings}
        onMappingChange={(name, id) =>
          setMappings((prev) => ({ ...prev, [name]: id }))
        }
        onCancel={reset}
        onCommit={handleCommit}
        isPending={isCommitPending}
        error={error}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UploadCloud />
          CSV ファイルを選択
        </CardTitle>
        <CardDescription>
          ファイル形式: Shift_JIS エンコードの .csv (座席表)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleParse}>
          <div className="space-y-2">
            <Label htmlFor="file">座席表 CSV</Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} ({Math.round(file.size / 1024)} KB)
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="size-4" />
              {error}
            </p>
          )}
          <Button type="submit" disabled={isParsePending || !file}>
            {isParsePending ? "解析中..." : "読み取り"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------- */
/*  Preview stage                                                       */
/* -------------------------------------------------------------------- */

function PreviewStage({
  bundle,
  tutors,
  mappings,
  onMappingChange,
  onCancel,
  onCommit,
  isPending,
  error,
}: {
  bundle: ParsedBundle;
  tutors: Tutor[];
  mappings: Mappings;
  onMappingChange: (name: string, id: string) => void;
  onCancel: () => void;
  onCommit: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const { parsed } = bundle;

  const stats = useMemo(() => {
    let teacherRows = 0;
    let studentAssignments = 0;
    for (const day of parsed.days) {
      for (const slot of day.slots) {
        teacherRows += slot.assignments.length;
        for (const a of slot.assignments)
          studentAssignments += a.students.length;
      }
    }
    return {
      teacherRows,
      studentAssignments,
      holidays: parsed.days.filter((d) => d.isHoliday).length,
    };
  }, [parsed]);

  const unmatchedCount = parsed.uniqueTeacherNames.filter(
    (n) => !mappings[n],
  ).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">取り込み内容</CardTitle>
          <CardDescription>
            {parsed.weekStart} 〜 {parsed.weekEnd} / {bundle.originalFilename}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="講師" value={parsed.uniqueTeacherNames.length} suffix="名" />
            <Stat label="生徒" value={parsed.uniqueStudentNames.length} suffix="名" />
            <Stat label="出勤" value={stats.teacherRows} suffix="件" />
            <Stat label="休日" value={stats.holidays} suffix="日" />
          </div>
          {parsed.activeTrainings.length > 0 && (
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">有効な講習期間</p>
              {parsed.activeTrainings.map((t) => (
                <p key={t.name}>
                  {t.name}（{t.startDate}〜{t.endDate}）
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            講師の対応付け
            {unmatchedCount > 0 && (
              <Badge variant="destructive" className="ml-2">
                {unmatchedCount} 件 未対応
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            CSV の講師名をシステム上の講師アカウントに割り当てます。自動一致したものは事前選択済みです。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tutors.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              講師アカウントが登録されていません。
              先に Supabase の <code>profiles</code> テーブル (role = tutor) に登録してください。
            </div>
          ) : (
            <div className="divide-y">
              {parsed.uniqueTeacherNames.map((name) => {
                const current = mappings[name] ?? "";
                const matched = Boolean(current);
                return (
                  <div
                    key={name}
                    className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{name}</span>
                      {matched ? (
                        <Badge variant="secondary">対応OK</Badge>
                      ) : (
                        <Badge variant="destructive">未対応</Badge>
                      )}
                    </div>
                    <select
                      value={current}
                      onChange={(e) => onMappingChange(name, e.target.value)}
                      className={cn(
                        "h-9 min-w-[200px] rounded-md border bg-background px-2 text-sm",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      )}
                    >
                      <option value="">— 未選択 —</option>
                      {tutors.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">日別サマリ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {parsed.days.map((d) => {
              const wLabel = WEEKDAYS.find((w) => w.key === d.weekday)?.label ?? "";
              const total = d.slots.reduce((a, s) => a + s.assignments.length, 0);
              return (
                <div
                  key={d.date}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>
                    {d.date}（{wLabel}）
                  </span>
                  {d.isHoliday ? (
                    <Badge variant="outline">休日</Badge>
                  ) : (
                    <span className="text-muted-foreground">{total} 出勤</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="flex items-center gap-1 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          キャンセル
        </Button>
        <Button onClick={onCommit} disabled={isPending || unmatchedCount > 0}>
          {isPending ? "公開中..." : "確定公開"}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Small bits                                                           */
/* -------------------------------------------------------------------- */

function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">
        {value}
        {suffix && <span className="ml-1 text-sm text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
