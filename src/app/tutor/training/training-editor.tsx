"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import { cn } from "@/lib/utils";
import { shortDate } from "@/lib/week";
import {
  checkDateRange,
  TRAINING_RANGE_LABEL,
  type DateRange,
  type TrainingRangeKind,
} from "@/lib/training-ranges";
import { Input } from "@/components/ui/input";
import {
  saveTrainingNote,
  saveTrainingRange,
  setTrainingSlot,
  setTrainingSlotsBulk,
  submitTraining,
  unsubmitTraining,
} from "./actions";

/** 曜日ラベルから色クラス (土=青 / 日=赤 / 平日=既定) を返す */
function weekdayColor(weekdayLabel: string): string {
  if (weekdayLabel === "土") return "text-blue-600";
  if (weekdayLabel === "日") return "text-red-600";
  return "text-foreground";
}

type SlotDef = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};
type Day = { date: string; weekdayLabel: string; isWeekend: boolean };
type Period = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  submissionDeadline: string;
  isReopened: boolean;
  daysLeft: number;
  editable: boolean;
};

export type TrainingEditorProps = {
  data: {
    period: Period;
    slots: SlotDef[];
    days: Day[];
    selected: string[];
    note: string;
    ranges: Record<TrainingRangeKind, DateRange>;
    submittedAt: string | null;
  };
};

const key = (date: string, slot: number) => `${date}|${slot}`;

export function TrainingEditor({ data }: TrainingEditorProps) {
  const { period, slots, days } = data;
  // 本番チェック No.12: 提出済みのあいだは締切前でも編集させない
  // (「修正する」で提出を取り下げると、また編集できる)
  const [submittedAt, setSubmittedAt] = useState(data.submittedAt);
  const editable = period.editable && submittedAt === null;

  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(data.selected),
  );
  const [note, setNote] = useState(data.note);
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);
  const [savingCount, setSavingCount] = useState(0);
  // 「一覧へ戻る」で保存の終わりを待つため、state と同じ値を ref にも持つ
  const savingRef = useRef(0);
  const bumpSaving = useCallback((d: 1 | -1) => {
    savingRef.current += d;
    setSavingCount((c) => c + d);
  }, []);
  const [leaving, setLeaving] = useState(false);
  // 提出・一時保存の結果はボタンのすぐ上に出す (上の通知は画面外になりやすい)
  const [footerNotice, setFooterNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // リクエスト中のコマ (連打・並走ガード用)
  const pendingSlots = useRef<Set<string>>(new Set());

  /**
   * 単一/一括共通の楽観的更新 + 保存 + 失敗時ロールバック。
   * 対象コマのいずれかがリクエスト中なら受け付けず通知する
   * (on/off が並走すると適用順が保証されず UI と DB がズレるため)。
   */
  const applySlots = useCallback(
    async (date: string, slotNums: number[], turningOn: boolean) => {
      const keys = slotNums.map((n) => key(date, n));
      if (keys.some((k) => pendingSlots.current.has(k))) {
        setNotice({
          type: "error",
          text: "保存中です。少し待ってからもう一度お試しください。",
        });
        return;
      }
      keys.forEach((k) => pendingSlots.current.add(k));

      // 楽観的更新。ロールバック用スナップショットは updater 内で
      // 実際の直前状態から取る (render 時の closure だと古い場合がある)
      let prevState = new Map<string, boolean>();
      setSelected((prev) => {
        prevState = new Map(keys.map((k) => [k, prev.has(k)]));
        const next = new Set(prev);
        keys.forEach((k) => {
          if (turningOn) next.add(k);
          else next.delete(k);
        });
        return next;
      });
      bumpSaving(1);

      // action が例外で落ちた場合 (通信断など) もロールバック + エラー表示する
      const res = await (
        slotNums.length === 1
          ? setTrainingSlot({
              periodId: period.id,
              date,
              slotNumber: slotNums[0],
              on: turningOn,
            })
          : setTrainingSlotsBulk({
              periodId: period.id,
              date,
              slotNumbers: slotNums,
              on: turningOn,
            })
      ).catch(toFailedResult);
      keys.forEach((k) => pendingSlots.current.delete(k));
      bumpSaving(-1);

      if (!res.ok) {
        // #202: reject 由来 = サーバーが書いたか不明。ここでロールバックすると
        // 「DB は保存済みなのに画面は元に戻る」= 能動的に嘘をつく。勝手に
        // 書き換えず、サーバーの真実を取りに行く。
        if (isIndeterminate(res)) {
          setNotice({ type: "error", text: res.error });
          router.refresh();
          return;
        }
        // 失敗 → 操作前の状態へロールバック
        setSelected((prev) => {
          const next = new Set(prev);
          prevState.forEach((was, k) => {
            if (was) next.add(k);
            else next.delete(k);
          });
          return next;
        });
        setNotice({ type: "error", text: res.error });
      }
    },
    [period.id, router, bumpSaving],
  );

  const toggle = useCallback(
    (date: string, slot: number) => {
      if (!editable) return;
      void applySlots(date, [slot], !selected.has(key(date, slot)));
    },
    [editable, selected, applySlots],
  );

  /** 1 日分の一括 ON/OFF (#159)。全コマ選択済みなら解除、そうでなければ全選択 */
  const toggleDay = useCallback(
    (date: string) => {
      if (!editable) return;
      const allOn = slots.every((s) => selected.has(key(date, s.slotNumber)));
      void applySlots(
        date,
        slots.map((s) => s.slotNumber),
        !allOn,
      );
    },
    [editable, selected, slots, applySlots],
  );

  // 備考のデバウンス保存
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNote = useRef<string | null>(null);
  const mounted = useRef(true);

  const flushNote = useCallback(async () => {
    if (noteTimer.current) {
      clearTimeout(noteTimer.current);
      noteTimer.current = null;
    }
    if (pendingNote.current === null) return;
    const v = pendingNote.current;
    pendingNote.current = null;
    if (mounted.current) bumpSaving(1);
    const res = await saveTrainingNote({ periodId: period.id, note: v }).catch(
      toFailedResult,
    );
    // unmount 後は state 更新できない (失敗していても通知は出せない。
    // 失敗内容は toFailedResult が console に残す)
    if (!mounted.current) return;
    bumpSaving(-1);
    if (!res.ok) setNotice({ type: "error", text: res.error });
    else setNotice({ type: "ok", text: "保存しました" });
  }, [period.id, bumpSaving]);

  // unmount 時: タイマー解除し、未保存があれば最後に保存を投げる
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (noteTimer.current) clearTimeout(noteTimer.current);
      if (pendingNote.current !== null) {
        // unmount 後は通知できないため、失敗は console 記録のみ
        void saveTrainingNote({
          periodId: period.id,
          note: pendingNote.current,
        }).catch(toFailedResult);
      }
    };
  }, [period.id]);

  function onNoteChange(v: string) {
    setNote(v);
    if (!editable) return;
    pendingNote.current = v;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => void flushNote(), 800);
  }

  // #319: テスト期間 / 夏休み。開始・終了がそろった (または両方消した) ときに保存する
  const [ranges, setRanges] = useState(data.ranges);
  const savedRanges = useRef(data.ranges);

  // 保存は 1 本ずつ順に投げる。日付欄は年を打つ途中でも change が起きるため、
  // 並べて投げると古い値の保存があとから着いて上書きしうる
  const rangeQueue = useRef<Promise<void>>(Promise.resolve());

  function onRangeChange(kind: TrainingRangeKind, patch: Partial<DateRange>) {
    const next = { ...ranges[kind], ...patch };
    setRanges((prev) => ({ ...prev, [kind]: next }));
    if (!editable || !checkDateRange(next).ok) return;
    rangeQueue.current = rangeQueue.current.then(() => saveRange(kind, next));
  }

  async function saveRange(kind: TrainingRangeKind, next: DateRange) {
    const saved = savedRanges.current[kind];
    if (saved.from === next.from && saved.to === next.to) return;
    bumpSaving(1);
    const res = await saveTrainingRange({
      periodId: period.id,
      kind,
      ...next,
    }).catch(toFailedResult);
    if (!mounted.current) return;
    bumpSaving(-1);
    if (res.ok) {
      savedRanges.current = { ...savedRanges.current, [kind]: next };
      setNotice({ type: "ok", text: "保存しました" });
    } else {
      setNotice({ type: "error", text: res.error });
      if (isIndeterminate(res)) router.refresh();
    }
  }

  /** 備考・期間・コマの保存が終わるまで待つ (コマは最大 10 秒) */
  async function waitForSaves() {
    await flushNote();
    await rangeQueue.current;
    for (let i = 0; i < 100 && savingRef.current > 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // PC ではクリックの押し下げで備考欄のフォーカスが外れて保存が始まる。
  // ボタンは押せるままにして、押したら保存の終わりを待ってから動く
  async function goBackToList() {
    setLeaving(true);
    if (editable) await waitForSaves();
    router.push("/tutor/training");
  }

  async function handleSubmit() {
    setLeaving(true);
    setFooterNotice(null);
    await waitForSaves();
    const res = await submitTraining({ periodId: period.id }).catch(
      toFailedResult,
    );
    if (!mounted.current) return;
    setLeaving(false);
    if (res.ok) {
      setSubmittedAt(new Date().toISOString());
      setFooterNotice({ type: "ok", text: "提出しました。" });
    } else {
      setFooterNotice({ type: "error", text: res.error });
      if (isIndeterminate(res)) router.refresh();
    }
  }

  async function handleUnsubmit() {
    setLeaving(true);
    setFooterNotice(null);
    const res = await unsubmitTraining({ periodId: period.id }).catch(
      toFailedResult,
    );
    if (!mounted.current) return;
    setLeaving(false);
    if (res.ok) {
      setSubmittedAt(null);
      setFooterNotice({
        type: "ok",
        text: "編集できるようにしました。直したら、もう一度「提出する」を押してください。",
      });
    } else {
      setFooterNotice({ type: "error", text: res.error });
      if (isIndeterminate(res)) router.refresh();
    }
  }

  const selectedCount = selected.size;

  return (
    <div className="space-y-4">
      {!period.editable && (
        <div className="flex items-center gap-2 rounded-md border border-muted bg-muted/50 px-3 py-2 text-sm">
          <Lock className="size-4" />
          提出締切を過ぎているため、閲覧のみです。変えたいときは上の「変更申請」から申請してください。
        </div>
      )}
      {period.editable && submittedAt && (
        <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <CheckCircle2 className="size-4 text-primary" />
          提出済みです。直すときは一番下の「修正する」を押してください。
        </div>
      )}

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

      {/* 操作案内 (#157): 詳細画面には何をする画面かの説明が無かった */}
      {editable && (
        <p className="text-sm text-muted-foreground">
          出勤できるコマをタップして選んでください。選んだ内容は自動で一時保存されます。
          最後に一番下の「提出する」を押すと、教室長に届きます。
        </p>
      )}

      {/* 日付カードの縦リスト */}
      <div className="space-y-2">
        {days.map((d) => {
          const dayOnCount = slots.filter((s) =>
            selected.has(key(d.date, s.slotNumber)),
          ).length;
          const daySelected = dayOnCount > 0;
          const dayAllSelected = dayOnCount === slots.length;
          return (
            <div key={d.date} className="rounded-xl border p-3">
              <div className="mb-2.5 flex items-center justify-between">
                <span
                  className={cn(
                    "text-sm font-bold",
                    weekdayColor(d.weekdayLabel),
                  )}
                >
                  {shortDate(d.date)}（{d.weekdayLabel}）
                </span>
                <div className="flex items-center gap-2">
                  {daySelected ? (
                    <Badge className="border-transparent bg-green-50 text-green-700 hover:bg-green-50">
                      選択済
                    </Badge>
                  ) : (
                    <Badge className="border-transparent bg-accent/15 text-accent hover:bg-accent/15">
                      未選択
                    </Badge>
                  )}
                  {/* #159: 1 タップでその日の全コマを選択/解除 */}
                  {editable && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 px-3 text-xs"
                      onClick={() => toggleDay(d.date)}
                    >
                      {dayAllSelected ? "全解除" : "全部選択"}
                    </Button>
                  )}
                </div>
              </div>
              {/* #158: タップ領域 44px 以上 + 誤タップしにくい間隔の grid */}
              <div className="grid grid-cols-4 gap-2">
                {slots.map((s) => {
                  const on = selected.has(key(d.date, s.slotNumber));
                  return (
                    <button
                      key={s.slotNumber}
                      type="button"
                      disabled={!editable}
                      onClick={() => toggle(d.date, s.slotNumber)}
                      title={`${s.startTime}〜${s.endTime}`}
                      aria-pressed={on}
                      className={cn(
                        "min-h-11 rounded-md border px-1 text-sm font-medium transition-colors",
                        on
                          ? "border-accent bg-accent text-accent-foreground"
                          : "border-input bg-background hover:bg-muted",
                        !editable && "cursor-not-allowed opacity-60",
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* コマの時間帯: モバイルは title が出ないため折りたたみで常設 (#131 と同方針) */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">
          コマの時間帯を見る
        </summary>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          {slots.map((s) => (
            <li key={s.slotNumber} className="flex justify-between gap-2">
              <span className="font-medium text-foreground">{s.label}</span>
              <span>
                {s.startTime}–{s.endTime}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {/* #319: 提出シフトのエクセルにある「テスト期間」「夏休み」 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">テスト期間・夏休み（任意）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(["test", "summer"] as const).map((kind) => {
            const r = ranges[kind];
            const check = checkDateRange(r);
            const label = TRAINING_RANGE_LABEL[kind];
            return (
              <div key={kind} className="space-y-1">
                <p className="text-sm font-medium">{label}</p>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    aria-label={`${label}の開始日`}
                    value={r.from ?? ""}
                    disabled={!editable}
                    onChange={(e) =>
                      onRangeChange(kind, { from: e.target.value || null })
                    }
                    className="min-w-0 flex-1"
                  />
                  <span className="text-muted-foreground">〜</span>
                  <Input
                    type="date"
                    aria-label={`${label}の終了日`}
                    value={r.to ?? ""}
                    min={r.from ?? undefined}
                    disabled={!editable}
                    onChange={(e) =>
                      onRangeChange(kind, { to: e.target.value || null })
                    }
                    className="min-w-0 flex-1"
                  />
                </div>
                {editable && (r.from !== null || r.to !== null) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onRangeChange(kind, { from: null, to: null })}
                  >
                    {label}を消す
                  </Button>
                )}
                {!check.ok && (
                  <p className="text-xs text-destructive">
                    {check.reason === "partial"
                      ? "開始日と終了日の両方を入れると保存されます（消すときは下の「消す」ボタンを押してください）。"
                      : "終了日は開始日以降にしてください。"}
                  </p>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            学校のテストや夏休みの期間があれば入れてください。開始日と終了日の両方を入れると自動保存されます。消すときは「〇〇を消す」を押してください。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">備考</CardTitle>
        </CardHeader>
        <CardContent>
          <Label htmlFor="note" className="sr-only">
            備考
          </Label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            onBlur={() => editable && void flushNote()}
            disabled={!editable}
            rows={3}
            maxLength={1000}
            placeholder="連絡事項があれば記入してください（例: 8/10〜8/15 は帰省のため不可）"
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 text-sm",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            入力すると自動保存されます。
          </p>
        </CardContent>
      </Card>

      {/* 完了バー (本番チェック No.12): 一時保存 / 提出する */}
      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>選択 {selectedCount} コマ</span>
          {savingCount > 0 && <span>保存中...</span>}
        </div>
        {footerNotice && (
          <p
            role="status"
            className={cn(
              "flex items-center gap-1 text-sm",
              footerNotice.type === "ok" ? "text-primary" : "text-destructive",
            )}
          >
            {footerNotice.type === "error" ? (
              <AlertCircle className="size-4 shrink-0" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0" />
            )}
            {footerNotice.text}
          </p>
        )}
        {period.editable && !submittedAt && (
          <>
            <Button
              type="button"
              className="w-full"
              disabled={leaving}
              onClick={() => void handleSubmit()}
            >
              {leaving ? "保存中..." : "提出する"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={leaving}
              onClick={() => void goBackToList()}
            >
              一時保存して一覧へ戻る
            </Button>
            <p className="text-xs text-muted-foreground">
              一時保存のままだと教室長には届きません。
            </p>
          </>
        )}
        {period.editable && submittedAt && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={leaving}
            onClick={() => void handleUnsubmit()}
          >
            修正する
          </Button>
        )}
        {(!period.editable || submittedAt) && (
          <Button
            type="button"
            variant={period.editable ? "ghost" : "default"}
            className="w-full"
            disabled={leaving}
            onClick={() => void goBackToList()}
          >
            一覧へ戻る
          </Button>
        )}
      </div>
    </div>
  );
}
