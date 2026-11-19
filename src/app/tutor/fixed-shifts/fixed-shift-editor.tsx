"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import { cn } from "@/lib/utils";
import { INPUT_WEEKDAYS, type InputWeekday } from "@/lib/shift-constants";
import {
  MAX_PREFERRED_STUDENTS,
  MAX_STUDENT_NAME,
  MAX_SUBJECT,
  type PreferredStudent,
} from "@/lib/preferred-students";
import { regularSubmissionNotes } from "@/lib/regular-submission-notes";
import {
  revertSubmissionToDraft,
  saveFixedShifts,
  submitFixedShifts,
} from "./actions";

type Slot = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};

// 'no' は cellState 不在で表現する (Issue #55)
type Availability = "yes" | "maybe";

type Entry = {
  weekday: InputWeekday;
  slotNumber: number;
  availability: Availability;
};

// DB enum (shift_submission_status) と UI 表示用の型を分ける。
// DB 側は "draft"/"submitted"/"frozen" の 3 値、UI は未保存状態を表す "none" を追加。
export type DbSubmissionStatus = "draft" | "submitted" | "frozen";
export type UiSubmissionStatus = DbSubmissionStatus | "none";

export type FixedShiftSubmissionMeta = {
  effectiveTo: string | null;
  desiredDays: number | null;
  desiredSlots: number | null;
  note: string | null;
  /** #319: 担当したい生徒・教科 */
  preferredStudents: PreferredStudent[];
  status: UiSubmissionStatus;
  submittedAt: string | null;
};

function cellKey(weekday: InputWeekday, slotNumber: number) {
  return `${weekday}:${slotNumber}`;
}

// 3値サイクル: yes (○) → maybe (△) → no (空) → yes
function cycleNext(current: Availability | undefined): Availability | undefined {
  if (current === "yes") return "maybe";
  if (current === "maybe") return undefined;
  return "yes";
}

function symbolFor(a: Availability | undefined): string {
  if (a === "yes") return "○";
  if (a === "maybe") return "△";
  return "";
}

function numberOrNull(s: string): number | null {
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function formatSubmittedAt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FixedShiftEditor({
  slots,
  initialEntries,
  initialEffectiveFrom,
  initialMeta,
  periodLocked = false,
  periodLabel = null,
  prefilledFrom = null,
  periodEndDate = null,
}: {
  slots: Slot[];
  initialEntries: Entry[];
  initialEffectiveFrom: string;
  initialMeta: FixedShiftSubmissionMeta;
  /**
   * #156: 受付中の期に紐づく提出のとき true。適用開始日 (= 期の開始日) を
   * 編集不可にし、提出が「どの期のものか」を明示する。
   */
  periodLocked?: boolean;
  periodLabel?: string | null;
  /**
   * #161: initialEntries が前期の提出内容のプリフィルである場合、その前期の
   * effective_from ("YYYY-MM-DD")。未保存の間だけ引き継ぎバナーを表示する。
   */
  prefilledFrom?: string | null;
  /** #319: 受付中の期の終了日。注意書きの「いつまでを想定しているか」に出す */
  periodEndDate?: string | null;
}) {
  const [cellStates, setCellStates] = useState<Map<string, Availability>>(
    () => new Map(initialEntries.map((e) => [cellKey(e.weekday, e.slotNumber), e.availability])),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(initialEffectiveFrom);
  const [effectiveTo, setEffectiveTo] = useState<string>(initialMeta.effectiveTo ?? "");
  // 月の日数の欄は出さなくなった (11/19)。保存で消えないよう、前の値をそのまま送る
  const desiredDays =
    initialMeta.desiredDays != null ? String(initialMeta.desiredDays) : "";
  const [desiredSlots, setDesiredSlots] = useState<string>(
    initialMeta.desiredSlots != null ? String(initialMeta.desiredSlots) : "",
  );
  const [note, setNote] = useState<string>(initialMeta.note ?? "");
  const [preferredStudents, setPreferredStudents] = useState<PreferredStudent[]>(
    initialMeta.preferredStudents,
  );
  const [status, setStatus] = useState<UiSubmissionStatus>(initialMeta.status);
  const router = useRouter();
  const [submittedAt, setSubmittedAt] = useState<string | null>(
    initialMeta.submittedAt,
  );

  // #202: 提出状態はサーバーが持つ真実で、利用者の編集対象ではない。
  // reject 後に router.refresh() でサーバーから読み直したとき、ここで
  // 追従しないと **画面に無いボタンを押せと言われる詰み** が起きる:
  // ローカルが draft のまま DB が submitted だと、保存時に「修正するには
  // 『下書きに戻す』を押してください」と言われるが、そのボタンは
  // isSubmitted (= ローカル state) が true のときしか描画されない。
  //
  // effect ではなくレンダー中に合わせる (React の「props から派生した state を
  // 調整する」パターン)。lint の set-state-in-effect も effect を禁じている。
  const [syncedMeta, setSyncedMeta] = useState(initialMeta);
  if (
    syncedMeta.status !== initialMeta.status ||
    syncedMeta.submittedAt !== initialMeta.submittedAt
  ) {
    setSyncedMeta(initialMeta);
    setStatus(initialMeta.status);
    setSubmittedAt(initialMeta.submittedAt);
  }
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Issue #61: status により編集可否を決定
  // - none / draft: 編集可能 (新規 or 下書き状態)
  // - submitted: 編集不可 (講師は「下書きに戻す」で開放できる)
  // - frozen: 完全 read-only (admin の介入が必要)
  const isEditable = status === "none" || status === "draft";
  const isSubmitted = status === "submitted";
  const isFrozen = status === "frozen";

  const yesCount = useMemo(
    () => [...cellStates.values()].filter((v) => v === "yes").length,
    [cellStates],
  );
  const maybeCount = useMemo(
    () => [...cellStates.values()].filter((v) => v === "maybe").length,
    [cellStates],
  );

  const entries = useMemo<Entry[]>(
    () =>
      [...cellStates.entries()].map(([k, availability]) => {
        const [weekday, slotNumber] = k.split(":") as [InputWeekday, string];
        return { weekday, slotNumber: Number(slotNumber), availability };
      }),
    [cellStates],
  );

  function cycle(weekday: InputWeekday, slotNumber: number) {
    if (!isEditable) return;
    const key = cellKey(weekday, slotNumber);
    setCellStates((prev) => {
      const next = new Map(prev);
      const after = cycleNext(prev.get(key));
      if (after === undefined) next.delete(key);
      else next.set(key, after);
      return next;
    });
  }

  function updateStudent(index: number, patch: Partial<PreferredStudent>) {
    setPreferredStudents((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  /** 今の画面の中身を下書きとして保存する (提出の前にも必ず通す) */
  function saveCurrent() {
    return saveFixedShifts({
      effectiveFrom,
      effectiveTo: effectiveTo === "" ? null : effectiveTo,
      desiredDays: numberOrNull(desiredDays),
      desiredSlots: numberOrNull(desiredSlots),
      note: note.trim() === "" ? null : note,
      preferredStudents,
      entries,
    }).catch(toFailedResult);
  }

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveCurrent();
      if (result.ok) {
        // 保存成功時は draft 状態 (none → draft も含む)
        setStatus("draft");
        setSubmittedAt(null);
        setMessage({ type: "success", text: "下書きとして保存しました。「提出」を押すと確定します。" });
      } else {
        setMessage({ type: "error", text: result.error });
        // #202: reject 由来は「書いたか不明」。サーバーから読み直す。
        if (isIndeterminate(result)) router.refresh();
      }
    });
  }

  function handleSubmit() {
    setMessage(null);
    startTransition(async () => {
      // 本番チェック No.6: 下書き保存を押していなくても提出できるように、
      // 先に今の画面の中身を保存してから提出する (保存し忘れた変更が
      // 提出から漏れるのも防ぐ)
      const saved = await saveCurrent();
      if (!saved.ok) {
        setMessage({ type: "error", text: saved.error });
        if (isIndeterminate(saved)) router.refresh();
        return;
      }
      setStatus("draft");
      setSubmittedAt(null);
      // PR #67 B-2: 引数なしでサーバ側が「最新 draft 行」を解決して submit する
      const result = await submitFixedShifts().catch(toFailedResult);
      if (result.ok) {
        setStatus("submitted");
        // PR #67 R-5: クライアントの new Date() ではなくサーバが実際に書いた値
        setSubmittedAt(result.submittedAt);
        setMessage({ type: "success", text: "提出しました。修正するには「下書きに戻す」を押してください。" });
      } else {
        setMessage({ type: "error", text: result.error });
        // #202: reject 由来は「書いたか不明」。サーバーから読み直す。
        if (isIndeterminate(result)) router.refresh();
      }
    });
  }

  function handleRevert() {
    setMessage(null);
    startTransition(async () => {
      // PR #67 B-2: 引数なしでサーバ側が「最新 submitted 行」を解決して revert する
      const result = await revertSubmissionToDraft().catch(toFailedResult);
      if (result.ok) {
        setStatus("draft");
        setSubmittedAt(null);
        setMessage({ type: "success", text: "下書きに戻しました。" });
      } else {
        setMessage({ type: "error", text: result.error });
        // #202: reject 由来は「書いたか不明」。サーバーから読み直す。
        if (isIndeterminate(result)) router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* #161: 前期プリフィルの引き継ぎバナー。保存 (draft 化) すると消える */}
      {prefilledFrom && status === "none" && (
        <div
          role="status"
          className="rounded-md border border-accent/50 bg-accent/5 px-3 py-2 text-sm"
        >
          前期 ({prefilledFrom} 開始分) の提出内容を引き継いで表示しています。
          内容を確認し、必要に応じて修正してから保存・提出してください。
        </div>
      )}

      {/* #319: レギュラーエクセルの注意書き。新しく入った講師にも伝える */}
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <p className="mb-1 font-semibold text-foreground">提出の前に</p>
        <ul className="list-disc space-y-0.5 pl-4">
          {regularSubmissionNotes(periodEndDate).map((line, i) => (
            <li key={i} className={cn(i === 0 && "font-semibold text-foreground")}>
              {line}
            </li>
          ))}
        </ul>
      </div>

      {/* Issue #61: 状態バッジ */}
      <div className="flex flex-wrap items-center gap-2">
        {status === "none" && (
          <Badge variant="outline">未保存</Badge>
        )}
        {status === "draft" && (
          <Badge variant="secondary">下書き</Badge>
        )}
        {isSubmitted && (
          <Badge>提出済み</Badge>
        )}
        {isFrozen && (
          <Badge variant="destructive">凍結中</Badge>
        )}
        {submittedAt && isSubmitted && (
          <span className="text-xs text-muted-foreground">
            {formatSubmittedAt(submittedAt)} に提出
          </span>
        )}
        {isFrozen && (
          <span className="text-xs text-muted-foreground">
            提出期間外か、教室長による凍結です。変えたいときは上の「変更申請」から申請してください。
          </span>
        )}
      </div>

      <div>
        <div className="grid grid-cols-[40px_repeat(6,minmax(0,1fr))] gap-1">
          {/* ヘッダー行: 曜日 */}
          <div />
          {INPUT_WEEKDAYS.map((w) => (
            <div
              key={w.key}
              className="flex items-center justify-center text-xs font-semibold text-muted-foreground"
            >
              {w.label}
            </div>
          ))}

          {/* コマ行 */}
          {slots.map((slot) => (
            <Fragment key={slot.slotNumber}>
              <div
                className="flex flex-col items-center justify-center leading-none text-muted-foreground"
                title={`${slot.label} ${slot.startTime}–${slot.endTime}`}
              >
                <span className="text-sm font-semibold">{slot.slotNumber}</span>
                <span className="mt-0.5 text-[9px]">限</span>
              </div>
              {INPUT_WEEKDAYS.map((w) => {
                const state = cellStates.get(cellKey(w.key, slot.slotNumber));
                const isYes = state === "yes";
                const isMaybe = state === "maybe";
                return (
                  <button
                    key={w.key}
                    type="button"
                    onClick={() => cycle(w.key, slot.slotNumber)}
                    disabled={!isEditable}
                    aria-label={`${w.label} ${slot.label} ${
                      isYes ? "出勤可" : isMaybe ? "可だが避けたい" : "不可"
                    }`}
                    className={cn(
                      "flex aspect-square w-full items-center justify-center rounded-md border text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      isYes &&
                        "border-accent bg-accent text-accent-foreground shadow-sm hover:bg-accent/90",
                      isMaybe &&
                        "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25",
                      !state && "border-input bg-background hover:bg-muted",
                    )}
                  >
                    {symbolFor(state)}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>

        {/* 凡例 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-3.5 rounded bg-accent" />出勤可 ○
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3.5 rounded border border-accent/40 bg-accent/15" />
            避けたい △
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3.5 rounded border border-input bg-background" />
            不可
          </span>
        </div>

        {/* コマの時間帯: モバイルは title ツールチップが出ないため折りたたみで常設 (#131 レビュー指摘1) */}
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            コマの時間帯を見る
          </summary>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            {slots.map((slot) => (
              <li key={slot.slotNumber} className="flex justify-between gap-2">
                <span className="font-medium text-foreground">{slot.label}</span>
                <span>
                  {slot.startTime}–{slot.endTime}
                </span>
              </li>
            ))}
          </ul>
        </details>

        {isEditable && (
          <p className="mt-2 text-xs text-muted-foreground">
            タップごとに ○ (出勤可) → △ (避けたい) → 空 (不可) → ○ … と循環します。
          </p>
        )}
      </div>

      <fieldset disabled={!isEditable} className="space-y-4 border-t pt-4">
        <p className="text-sm font-semibold text-muted-foreground">
          詳細設定（任意）
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="effective-from">適用開始日</Label>
            <Input
              id="effective-from"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="w-44"
              // #156: 期に紐づく提出では起点を期の開始日に固定 (改竄・取り違え防止)
              disabled={periodLocked}
            />
            <p className="text-xs text-muted-foreground">
              {periodLocked
                ? `${periodLabel ? `「${periodLabel}」` : "受付中の期"}の希望として、この開始日で保存されます。`
                : "この日以降の週から新しい設定が適用されます。"}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="effective-to">適用終了日 (任意)</Label>
            <Input
              id="effective-to"
              type="date"
              value={effectiveTo}
              min={effectiveFrom}
              onChange={(e) => setEffectiveTo(e.target.value)}
              className="w-44"
            />
            <p className="text-xs text-muted-foreground">
              空欄の場合は無期限。「いつまでこのシフトで出勤できるか」を伝えるときに記入。
            </p>
          </div>
          <div className="space-y-2">
            {/* 本番チェックの気づき5 (2026-11-19 本人): 聞きたいのは「1 週間に何コマ出たいか」だけ。
                月の日数の欄は出さない (既存の値は保存時もそのまま残す) */}
            <Label htmlFor="desired-slots">1 週間に出たいコマ数 (任意)</Label>
            <Input
              id="desired-slots"
              type="number"
              inputMode="numeric"
              min={0}
              max={56}
              value={desiredSlots}
              onChange={(e) => setDesiredSlots(e.target.value)}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              目安として、1 週間に何コマ出たいかを数字で書いてください。
            </p>
          </div>
        </div>

        {/* #319: 担当したい生徒・教科。1 行 = 生徒名 + 教科 */}
        <div className="space-y-2">
          <p className="text-sm font-medium">担当したい生徒 (任意)</p>
          {preferredStudents.length > 0 && (
            <ul className="space-y-2">
              {preferredStudents.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={`担当したい生徒 ${i + 1} の生徒名`}
                    value={r.student}
                    maxLength={MAX_STUDENT_NAME}
                    onChange={(e) => updateStudent(i, { student: e.target.value })}
                    placeholder="生徒名"
                    className="min-w-0 flex-[3]"
                  />
                  <Input
                    aria-label={`担当したい生徒 ${i + 1} の教科`}
                    value={r.subject}
                    maxLength={MAX_SUBJECT}
                    onChange={(e) => updateStudent(i, { subject: e.target.value })}
                    placeholder="教科"
                    className="min-w-0 flex-[2]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 px-2 text-muted-foreground"
                    aria-label={`担当したい生徒 ${i + 1} を消す`}
                    onClick={() =>
                      setPreferredStudents((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    消す
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {preferredStudents.length < MAX_PREFERRED_STUDENTS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPreferredStudents((prev) => [...prev, { student: "", subject: "" }])
              }
            >
              ＋ 生徒を追加
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            担当したい生徒がいれば、生徒名と教科を書いてください（{MAX_PREFERRED_STUDENTS} 人まで）。どちらか片方だけでも構いません。
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="note">フリースペース (任意)</Label>
          <textarea
            id="note"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="特記事項があれば記入してください (例: 一時的な事情、要望)"
          />
          <p className="text-xs text-muted-foreground">{note.length} / 1000</p>
        </div>
      </fieldset>

      <div className="space-y-3 border-t pt-4">
        <p className="text-center text-sm text-muted-foreground">
          選択中: ○ {yesCount} 枠 / △ {maybeCount} 枠
        </p>
        {isSubmitted && (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleRevert}
            disabled={isPending}
          >
            下書きに戻す
          </Button>
        )}
        {isEditable && (
          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending ? "..." : "この内容で提出"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSave}
              disabled={isPending}
            >
              {isPending ? "..." : "下書き保存"}
            </Button>
          </div>
        )}
      </div>

      {message && (
        <p
          role="status"
          className={cn(
            "text-sm",
            message.type === "success" ? "text-primary" : "text-destructive",
          )}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
