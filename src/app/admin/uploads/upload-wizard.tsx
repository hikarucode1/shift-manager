"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  UploadCloud,
} from "lucide-react";
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
import { findMappingDuplicates } from "@/lib/mapping-validation";
import { cn } from "@/lib/utils";
import { commitUploadedCsv, parseUploadedCsv } from "./actions";

type Tutor = { id: string; displayName: string; email: string };
type Mappings = Record<string, string>; // teacherName -> tutorId or ""

type Stage = "idle" | "parsed" | "done";

/** 対応OK バッジ (一致/推定一致=緑)。アプリ共通の green 慣習に合わせる。 */
const OK_BADGE =
  "border-transparent bg-green-50 text-green-700 hover:bg-green-50";

const WIZARD_STEPS = ["アップロード", "マッピング確認", "確定・公開"] as const;

/**
 * 取り込みウィザードのステッパー (#128 デザイン screen 7)。
 * 完了=primary 丸✓ / 現在=accent 丸 / 未=muted 丸。
 * current = 現在ステップの 0-based index。finished で全完了表示。
 */
function Stepper({
  current,
  finished = false,
}: {
  current: number;
  finished?: boolean;
}) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1 text-sm">
      {WIZARD_STEPS.map((label, i) => {
        const done = finished || i < current;
        const active = !finished && i === current;
        return (
          <li key={label} className="flex items-center gap-1">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                done && "bg-primary text-primary-foreground",
                active && "bg-accent text-accent-foreground",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "whitespace-nowrap",
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {label}
            </span>
            {i < WIZARD_STEPS.length - 1 && (
              <span
                className={cn(
                  "mx-1 h-px w-6 shrink-0",
                  done ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

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
      // Auto-map by exact display_name match.
      // 同名講師が複数いる場合 (#21) は順序依存の誤割当を避けるため
      // 自動選択せず未対応のまま残す (教室長が手動で選ぶ)。
      const byName = new Map<string, number>();
      for (const t of tutors) {
        byName.set(t.displayName, (byName.get(t.displayName) ?? 0) + 1);
      }
      const auto: Mappings = {};
      for (const name of res.parsed.uniqueTeacherNames) {
        const count = byName.get(name) ?? 0;
        auto[name] =
          count === 1
            ? (tutors.find((t) => t.displayName === name)?.id ?? "")
            : "";
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
    if (findMappingDuplicates(mappings).length > 0) {
      setError(
        "同じ講師アカウントに複数の CSV 名が割り当てられています。修正してください。",
      );
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
      <div className="space-y-4">
        <Stepper current={2} finished />
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
      </div>
    );
  }

  if (stage === "parsed" && bundle) {
    return (
      <div className="space-y-4">
        <Stepper current={1} />
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Stepper current={0} />
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
    </div>
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

  const duplicates = useMemo(
    () => findMappingDuplicates(mappings),
    [mappings],
  );
  const tutorNameById = useMemo(
    () => new Map(tutors.map((t) => [t.id, t.displayName])),
    [tutors],
  );
  /** displayName ごとの講師アカウント数 (同名検出用) */
  const tutorCountByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tutors) m.set(t.displayName, (m.get(t.displayName) ?? 0) + 1);
    return m;
  }, [tutors]);
  /** CSV 名が「同名アカウント複数」で自動割当できない集合 (#21) */
  const ambiguousCsvNames = useMemo(() => {
    const s = new Set<string>();
    for (const n of parsed.uniqueTeacherNames) {
      if ((tutorCountByName.get(n) ?? 0) > 1) s.add(n);
    }
    return s;
  }, [parsed.uniqueTeacherNames, tutorCountByName]);
  /** 同名複数のうち「まだ手動選択されていない」もの (警告カード用) */
  const unresolvedAmbiguous = useMemo(
    () => [...ambiguousCsvNames].filter((n) => !mappings[n]),
    [ambiguousCsvNames, mappings],
  );
  /** 重複に巻き込まれている CSV 名の集合 (行ハイライト用) */
  const conflictingCsvNames = useMemo(() => {
    const s = new Set<string>();
    for (const d of duplicates) for (const n of d.csvNames) s.add(n);
    return s;
  }, [duplicates]);
  const hasDuplicates = duplicates.length > 0;

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
            {hasDuplicates && (
              <Badge variant="destructive" className="ml-2">
                {duplicates.length} 件 重複
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
                    className={cn(
                      "flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-3",
                      conflictingCsvNames.has(name) &&
                        "-mx-2 rounded-md bg-destructive/10 px-2",
                    )}
                  >
                    {/* CSV 講師名 (固定幅列では長名を省略表示、フル名は title で) */}
                    <span
                      title={name}
                      className="text-sm font-medium sm:w-36 sm:shrink-0 sm:truncate"
                    >
                      {name}
                    </span>
                    <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
                    {/* 紐付け先 (Select) */}
                    <select
                      value={current}
                      onChange={(e) => onMappingChange(name, e.target.value)}
                      className={cn(
                        "h-9 min-w-[200px] rounded-md border bg-background px-2 text-sm sm:flex-1",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      )}
                    >
                      <option value="">— 未選択 —</option>
                      {tutors.map((t) => (
                        <option key={t.id} value={t.id}>
                          {/* 同名が複数いる時はメール併記で判別可能に (#21) */}
                          {(tutorCountByName.get(t.displayName) ?? 0) > 1
                            ? `${t.displayName}（${t.email}）`
                            : t.displayName}
                        </option>
                      ))}
                    </select>
                    {/* 状態 */}
                    <div className="sm:w-24 sm:shrink-0 sm:text-right">
                      {!matched ? (
                        ambiguousCsvNames.has(name) ? (
                          <Badge variant="destructive">要手動選択</Badge>
                        ) : (
                          <Badge variant="destructive">未対応</Badge>
                        )
                      ) : conflictingCsvNames.has(name) ? (
                        <Badge variant="destructive">重複</Badge>
                      ) : (
                        <Badge className={OK_BADGE}>対応OK</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {hasDuplicates && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertCircle className="size-4" />
              同じ講師アカウントへの重複割当
            </CardTitle>
            <CardDescription>
              1 つのアカウントに複数の CSV 名を割り当てると、同じ講師が同じコマに重複し公開できません。
              いずれかを別のアカウントに変更してください。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {duplicates.map((d) => (
                <li
                  key={d.tutorId}
                  className="rounded-md bg-destructive/10 px-3 py-2"
                >
                  <span className="font-medium">
                    {tutorNameById.get(d.tutorId) ?? "(不明な講師)"}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    ← CSV「{d.csvNames.join("」「")}」
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {unresolvedAmbiguous.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertCircle className="size-4" />
              同名の講師アカウントが複数あります
            </CardTitle>
            <CardDescription>
              以下の名前は同名アカウントが複数あるため自動割当していません。
              ドロップダウン（メール併記）から正しい講師を手動で選択してください。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {unresolvedAmbiguous.map((n) => (
                <li
                  key={n}
                  className="rounded-md bg-destructive/10 px-3 py-2"
                >
                  <span className="font-medium">{n}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    （該当アカウント{tutorCountByName.get(n)}件）
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

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
          戻る
        </Button>
        <Button
          onClick={onCommit}
          disabled={isPending || unmatchedCount > 0 || hasDuplicates}
        >
          {isPending ? "公開中..." : "確定して公開"}
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
