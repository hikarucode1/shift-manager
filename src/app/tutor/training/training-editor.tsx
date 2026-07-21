"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { shortDate } from "@/lib/week";
import { saveTrainingNote, setTrainingSlot } from "./actions";

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
  };
};

const key = (date: string, slot: number) => `${date}|${slot}`;

/**
 * action の reject (通信断・サーバー障害など) を通知用の失敗結果へ変換する。
 * 原因はユーザーには区別できないため文言は中立にし、診断用に console へ残す。
 */
function toFailedResult(e: unknown): { ok: false; error: string } {
  console.error("training action failed:", e);
  return {
    ok: false,
    error: "保存に失敗しました。通信状況を確認して再度お試しください。",
  };
}

export function TrainingEditor({ data }: TrainingEditorProps) {
  const { period, slots, days } = data;
  const editable = period.editable;

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(data.selected),
  );
  const [note, setNote] = useState(data.note);
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);
  const [savingCount, setSavingCount] = useState(0);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const toggle = useCallback(
    async (date: string, slot: number) => {
      if (!editable) return;
      const k = key(date, slot);
      // 連打ガード: 同一コマの先行リクエストが完了するまで無視する。
      // on/off が並走すると適用順が保証されず UI と DB がズレるため。
      if (pendingSlots.current.has(k)) return;
      pendingSlots.current.add(k);
      const turningOn = !selected.has(k);

      // 楽観的更新
      setSelected((prev) => {
        const next = new Set(prev);
        if (turningOn) next.add(k);
        else next.delete(k);
        return next;
      });
      setSavingCount((c) => c + 1);

      // action が例外で落ちた場合 (通信断など) もロールバック + エラー表示する
      const res = await setTrainingSlot({
        periodId: period.id,
        date,
        slotNumber: slot,
        on: turningOn,
      }).catch(toFailedResult);
      pendingSlots.current.delete(k);
      setSavingCount((c) => c - 1);

      if (!res.ok) {
        // 失敗 → ロールバック
        setSelected((prev) => {
          const next = new Set(prev);
          if (turningOn) next.delete(k);
          else next.add(k);
          return next;
        });
        setNotice({ type: "error", text: res.error });
      }
    },
    [editable, period.id, selected],
  );

  // リクエスト中のコマ (連打ガード用)
  const pendingSlots = useRef<Set<string>>(new Set());

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
    if (mounted.current) setSavingCount((c) => c + 1);
    const res = await saveTrainingNote({ periodId: period.id, note: v }).catch(
      toFailedResult,
    );
    // unmount 後は state 更新できない (失敗していても通知は出せない。
    // 失敗内容は toFailedResult が console に残す)
    if (!mounted.current) return;
    setSavingCount((c) => c - 1);
    if (!res.ok) setNotice({ type: "error", text: res.error });
    else setNotice({ type: "ok", text: "保存しました" });
  }, [period.id]);

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

  const selectedCount = selected.size;

  return (
    <div className="space-y-4">
      {!editable && (
        <div className="flex items-center gap-2 rounded-md border border-muted bg-muted/50 px-3 py-2 text-sm">
          <Lock className="size-4" />
          提出締切を過ぎているため、閲覧のみ可能です（変更は教室長が再開放した場合のみ）。
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
          出勤できるコマをタップして選んでください。タップするたびに選択/解除が
          切り替わり、自動で保存されます。締切までは何度でも変更できます。
        </p>
      )}

      {/* 日付カードの縦リスト */}
      <div className="space-y-2">
        {days.map((d) => {
          const daySelected = slots.some((s) =>
            selected.has(key(d.date, s.slotNumber)),
          );
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
                {daySelected ? (
                  <Badge className="border-transparent bg-green-50 text-green-700 hover:bg-green-50">
                    選択済
                  </Badge>
                ) : (
                  <Badge className="border-transparent bg-accent/15 text-accent hover:bg-accent/15">
                    未選択
                  </Badge>
                )}
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

      {/* 完了バー: 選択は自動保存されるため、ここは確認 + 一覧への導線 */}
      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>選択 {selectedCount} コマ</span>
          {savingCount > 0 ? (
            <span>保存中...</span>
          ) : (
            <span>選んだコマは自動で保存されます</span>
          )}
        </div>
        <Button asChild className="w-full">
          <Link
            href="/tutor/training"
            aria-disabled={savingCount > 0}
            tabIndex={savingCount > 0 ? -1 : undefined}
            className={cn(
              savingCount > 0 && "pointer-events-none opacity-60",
            )}
          >
            {savingCount > 0 ? "保存中..." : "一覧へ戻る"}
          </Link>
        </Button>
      </div>
    </div>
  );
}
