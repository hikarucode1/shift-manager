"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ThermometerSnowflake,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isIndeterminate, toFailedResult } from "@/lib/action-failure";
import { cn } from "@/lib/utils";
import { INPUT_WEEKDAYS } from "@/lib/shift-constants";
import { setSubmissionFrozen } from "./actions";
import {
  saveMonthlyConfirmation,
  saveRegularConfirmation,
} from "./confirm-actions";
import { SubjectFilterBar, TrackDot } from "@/components/subject-filter-bar";
import {
  NO_SUBJECT_FILTER,
  isSubjectFilterOn,
  matchFirst,
  matchesSubjectFilter,
  type SubjectFilter,
} from "@/lib/tutor-subjects";
import {
  formatPreferredStudents,
  type PreferredStudent,
} from "@/lib/preferred-students";

type Assignment = {
  tutorId: string;
  weekday: string;
  slotNumber: number;
};

type Slot = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};

type SubmissionView = {
  effectiveFrom: string;
  effectiveTo: string | null;
  desiredDays: number | null;
  desiredSlots: number | null;
  note: string | null;
  /** #319: 担当したい生徒・教科 */
  preferredStudents: PreferredStudent[];
  status: "draft" | "submitted" | "frozen";
  submittedAt: string | null;
  lastStatusChangedAt: string | null;
};

type TutorView = {
  id: string;
  displayName: string;
  email: string;
  /** #350: 文理 (未登録は null) と担当できる科目の key */
  track: string | null;
  subjects: string[];
  submission: SubmissionView | null;
  entries: Array<{
    weekday: string;
    slotNumber: number;
    availability: "yes" | "maybe" | "no";
  }>;
};

type PeriodView = {
  id: string;
  /** Issue #72 (β): 期 (regular_shift_periods) の admin 手動ラベル */
  label: string;
  /** YYYY-MM-DD (期の開始日) */
  startDate: string;
  /** YYYY-MM-DD (期の終了日) */
  endDate: string;
  submissionOpensAt: string;
  submissionDueAt: string;
};

/** "2026-07-01" → "2026年7月" */
function formatMonth(iso: string): string {
  const [y, m] = iso.split("-");
  return `${Number(y)}年${Number(m)}月`;
}

/** ISO → JST "MM/DD HH:mm" */
function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeProps(
  status: SubmissionView["status"] | "未提出",
): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  switch (status) {
    case "draft":
      return { label: "下書き", variant: "secondary" };
    case "submitted":
      return { label: "提出済み", variant: "default" };
    case "frozen":
      return { label: "凍結中", variant: "destructive" };
    case "未提出":
      return { label: "未提出", variant: "outline" };
  }
}

function symbolFor(a: "yes" | "maybe" | "no" | undefined): string {
  if (a === "yes") return "○";
  if (a === "maybe") return "△";
  return "";
}

/** 講師別ステータスの数のタイル。key は submission.status (未提出は "none") */
const STATUS_TILES = [
  { key: "submitted", label: "提出済み", tone: "border-primary/30 bg-primary/5" },
  { key: "draft", label: "下書き（未提出）", tone: "border-amber-300 bg-amber-50" },
  { key: "none", label: "未提出", tone: "border-destructive/30 bg-destructive/5" },
] as const;

/** (tutorId, weekday, slot) を 1 つの文字列 key にする */
function assignKey(tutorId: string, weekday: string, slot: number): string {
  return `${tutorId}:${weekday}:${slot}`;
}

export function AdminSubmissionsOverview({
  targetMonth,
  slots,
  tutors,
  initialConfirmed,
  period,
}: {
  targetMonth: string;
  slots: Slot[];
  tutors: TutorView[];
  initialConfirmed: Assignment[];
  period: PeriodView | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { type: "ok" | "error"; text: string } | null
  >(null);

  // C2 #63: 確定枠 set (key = "tutorId:weekday:slot")。クリックでトグル。
  // 「確定保存」ボタンで bulk saveMonthlyConfirmation に渡し replace 保存。
  const [confirmedSet, setConfirmedSet] = useState<Set<string>>(
    () =>
      new Set(
        initialConfirmed.map((a) =>
          assignKey(a.tutorId, a.weekday, a.slotNumber),
        ),
      ),
  );
  // 初期確定セットからの変更検知 (未保存変更がある時 ボタン強調)
  const [confirmDirty, setConfirmDirty] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  // #350: 文理・科目で絞り込む。合わない人は消さずに薄くし、合う人を先頭に出す
  // (確定済みの人が見えなくなって外し忘れないように。11/18 本人)
  const [subjectFilter, setSubjectFilter] =
    useState<SubjectFilter>(NO_SUBJECT_FILTER);
  const filterOn = isSubjectFilterOn(subjectFilter);
  const isMatch = (t: TutorView) =>
    !filterOn || matchesSubjectFilter(t, subjectFilter);
  const sortedTutors = matchFirst(tutors, isMatch);

  // 講師別ステータス: 全員分のカードは開いたときだけ出す (11/18 本人)
  const [showAllStatus, setShowAllStatus] = useState(false);
  const frozenCount = tutors.filter(
    (t) => t.submission?.status === "frozen",
  ).length;
  const notYet = sortedTutors.filter(
    (t) => t.submission === null || t.submission.status === "draft",
  );
  const withNotes = sortedTutors.filter(
    (t) =>
      t.submission &&
      (t.submission.note || t.submission.preferredStudents.length > 0),
  );

  // 月選択用 input ("YYYY-MM")
  const [monthInput, setMonthInput] = useState(targetMonth.slice(0, 7));

  function applyMonth() {
    const candidate = `${monthInput}-01`;
    if (!/^\d{4}-\d{2}-01$/.test(candidate)) {
      setNotice({ type: "error", text: "対象月の形式が不正です。" });
      return;
    }
    router.push(`/admin/fixed-shifts?month=${candidate}`);
  }

  // 各 tutor の entries を Map に変換 (描画時の O(1) lookup 用)
  const entryMaps = useMemo(() => {
    const m = new Map<string, Map<string, "yes" | "maybe" | "no">>();
    for (const t of tutors) {
      const inner = new Map<string, "yes" | "maybe" | "no">();
      for (const e of t.entries) {
        inner.set(`${e.weekday}:${e.slotNumber}`, e.availability);
      }
      m.set(t.id, inner);
    }
    return m;
  }, [tutors]);

  // #361: 曜日ごとの確定数 (曜日の切り替えボタンに出す)
  const confirmedCountByWeekday = useMemo(() => {
    const m = new Map<string, number>();
    for (const key of confirmedSet) {
      const w = key.split(":")[1];
      m.set(w, (m.get(w) ?? 0) + 1);
    }
    return m;
  }, [confirmedSet]);

  // メモ27: 講師ごとの「確定 ÷ 出られる (○と△)」。押すたびに変わる
  const rates = (() => {
    const cells = new Set(
      INPUT_WEEKDAYS.flatMap((w) =>
        slots.map((sl) => `${w.key}:${sl.slotNumber}`),
      ),
    );
    const list = sortedTutors.map((t) => {
      const available = t.entries.filter(
        (e) =>
          (e.availability === "yes" || e.availability === "maybe") &&
          cells.has(`${e.weekday}:${e.slotNumber}`),
      ).length;
      let confirmed = 0;
      for (const key of confirmedSet) {
        if (key.startsWith(`${t.id}:`)) confirmed++;
      }
      const pct = available > 0 ? Math.round((confirmed / available) * 100) : null;
      return { tutor: t, available, confirmed, pct };
    });
    // % の低い順。出られるコマが無い人 (未提出など) は最後
    return list.sort((a, b) => {
      if (a.pct === null && b.pct === null) return 0;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return a.pct - b.pct;
    });
  })();

  function handleFreeze(tutorId: string, effectiveFrom: string, freeze: boolean) {
    setNotice(null);
    startTransition(async () => {
      const result = await setSubmissionFrozen({
        tutorId,
        effectiveFrom,
        freeze,
      }).catch(toFailedResult);
      if (result.ok) {
        setNotice({
          type: "ok",
          text: freeze ? "凍結しました。" : "凍結を解除して下書きに戻しました。",
        });
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
        // #202: reject 由来は「書いたか不明」なのでサーバーから読み直す。
        if (isIndeterminate(result)) router.refresh();
      }
    });
  }

  // C2 #63: 確定セルのトグル
  function toggleConfirmed(tutorId: string, weekday: string, slot: number) {
    const key = assignKey(tutorId, weekday, slot);
    setConfirmedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setConfirmDirty(true);
  }

  // 確定セットを Assignment[] に変換 (handleSaveConfirmation / handleSaveRegular 共通)
  function currentAssignments(): Assignment[] {
    return Array.from(confirmedSet).map((key) => {
      const [tutorId, weekday, slotStr] = key.split(":");
      return { tutorId, weekday, slotNumber: Number(slotStr) };
    });
  }

  // Issue #74 (δ): 単月の bulk 確定保存。期 (period) が紐付いていないと
  // periodId を渡せないので、当月をカバーする期が存在することが前提。
  function handleSaveConfirmation() {
    if (!period) {
      setNotice({
        type: "error",
        text: "対象月をカバーする期が見つかりません。/admin/regular-periods で先に期を作成してください。",
      });
      return;
    }
    setNotice(null);
    const assignments = currentAssignments();
    startTransition(async () => {
      const result = await saveMonthlyConfirmation({
        periodId: period.id,
        targetMonth,
        assignments,
      }).catch(toFailedResult);
      if (result.ok) {
        setConfirmDirty(false);
        setNotice({
          type: "ok",
          text: `確定 ${result.inserted} 枠を保存しました。`,
        });
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
        // #202: reject 由来は「書いたか不明」なのでサーバーから読み直す。
        if (isIndeterminate(result)) router.refresh();
      }
    });
  }

  // γ #73 + #84 (1): 期内の全月に同じ確定を一括保存。期 (period) が紐付いている時のみ可。
  // 確認モーダルでは「適用元 = 現在閲覧中の月の確定セット」を明示する。閲覧中の月以外で
  // saveMonthlyConfirmation 経由の月単位調整が入っていると、その調整が一括上書きで消える
  // ため、admin が「気付かずに別月の調整を消した」事故を起こしにくくする。
  function handleSaveRegularConfirmation() {
    if (!period) return;
    const assignments = currentAssignments();
    const confirmed = window.confirm(
      `期「${period.label}」(${period.startDate} 〜 ${period.endDate}) ` +
        `のすべての月に同じ ${assignments.length} 枠を保存します。\n\n` +
        `※ 適用される ${assignments.length} 枠は ${formatMonth(targetMonth)} の画面で ✓ を付けたものです。\n` +
        `ほかの月で「その月だけ保存」をしていた場合、その分は\n` +
        `この内容で上書きされます。\n\n` +
        `続行しますか?`,
    );
    if (!confirmed) return;
    setNotice(null);
    startTransition(async () => {
      const result = await saveRegularConfirmation({
        periodId: period.id,
        assignments,
      }).catch(toFailedResult);
      if (result.ok) {
        setConfirmDirty(false);
        setNotice({
          type: "ok",
          text: `期のすべての月に ${result.inserted} 枠を保存しました。`,
        });
        router.refresh();
      } else {
        setNotice({ type: "error", text: result.error });
        // #202: reject 由来は「書いたか不明」なのでサーバーから読み直す。
        if (isIndeterminate(result)) router.refresh();
      }
    });
  }

  // C2 #63: 提出済み (submitted) の ○ をすべて確定セットに取り込む補助操作
  function bulkConfirmAllSubmittedYes() {
    setConfirmedSet((prev) => {
      const next = new Set(prev);
      for (const t of tutors) {
        if (t.submission?.status !== "submitted") continue;
        for (const e of t.entries) {
          if (e.availability === "yes") {
            next.add(assignKey(t.id, e.weekday, e.slotNumber));
          }
        }
      }
      return next;
    });
    setConfirmDirty(true);
  }

  return (
    <div className="space-y-6">
      {/* 月選択 + アクティブ期間情報 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">対象月</CardTitle>
          <CardDescription>
            選択した月の effective_from を持つ提出を表示します。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="target-month">対象月</Label>
            <Input
              id="target-month"
              type="month"
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value)}
              className="w-48"
            />
          </div>
          <Button onClick={applyMonth} disabled={isPending}>
            表示
          </Button>
          {period && (
            <div className="ml-2 text-xs text-muted-foreground">
              <div>
                期: <span className="font-medium">{period.label}</span> (
                {period.startDate} 〜 {period.endDate})
              </div>
              <div>
                提出受付: {fmtJst(period.submissionOpensAt)} 〜{" "}
                {fmtJst(period.submissionDueAt)}
              </div>
            </div>
          )}
          {!period && (
            <div className="ml-2 text-xs text-muted-foreground">
              この月を含む期は未設定 (admin /admin/regular-periods で作成)
            </div>
          )}
        </CardContent>
      </Card>

      {notice && (
        <p
          role="status"
          className={cn(
            "text-sm",
            notice.type === "ok" ? "text-primary" : "text-destructive",
          )}
        >
          {notice.text}
        </p>
      )}

      {/* #350: 下の 2 つのカードに効く */}
      <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
        <p className="text-sm font-medium">文理・科目で絞り込む</p>
        <SubjectFilterBar value={subjectFilter} onChange={setSubjectFilter} />
        {filterOn && (
          <p className="text-xs text-muted-foreground">
            合う講師 {tutors.filter(isMatch).length} 人を先頭に出し、合わない講師は薄く表示しています。「＋ 希望に無い講師を入れる」では、合う講師の名前に ● が付きます。
          </p>
        )}
      </div>

      {/* 講師ごとのステータスカード
          (11/18 本人: 1 人 1 枚のカードだと縦に長いので、数と「まだの人」だけを
          先に出し、全員分は開いたときだけ出す) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            講師別ステータス ({formatMonth(targetMonth)})
          </CardTitle>
          <CardDescription>
            {tutors.length} 名分の提出状況です。
            {frozenCount > 0 &&
              ` 凍結中の提出が ${frozenCount} 件あります（「提出状況を確認する」から解除できます）。`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {STATUS_TILES.map((tile) => {
              const n = tutors.filter(
                (t) => (t.submission?.status ?? "none") === tile.key,
              ).length;
              return (
                <div
                  key={tile.key}
                  className={cn("rounded-lg border p-3", n > 0 && tile.tone)}
                >
                  <p className="text-xs text-muted-foreground">{tile.label}</p>
                  <p className="text-2xl font-bold tabular-nums">
                    {n}
                    <span className="ml-0.5 text-sm font-normal">名</span>
                  </p>
                </div>
              );
            })}
          </div>

          {/* 声をかける相手 */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              まだ提出していない人 ({notYet.length} 名)
            </p>
            {notYet.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                全員が提出しました。
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {notYet.map((t) => (
                  <span
                    key={t.id}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                      !isMatch(t) && "opacity-40",
                    )}
                  >
                    <TrackDot track={t.track} />
                    {t.displayName}
                    {t.submission?.status === "draft" && (
                      <span className="text-muted-foreground">（下書き）</span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {withNotes.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                メモ・担当したい生徒の書き込み ({withNotes.length} 名)
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {withNotes.map((t) => (
                  <li key={t.id}>
                    <span className="font-medium text-foreground">
                      {t.displayName}
                    </span>
                    {t.submission!.preferredStudents.length > 0 && (
                      <>
                        ：担当したい生徒{" "}
                        {formatPreferredStudents(
                          t.submission!.preferredStudents,
                        )}
                      </>
                    )}
                    {t.submission!.note && (
                      <span className="whitespace-pre-wrap">
                        ：📝 {t.submission!.note}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            aria-expanded={showAllStatus}
            onClick={() => setShowAllStatus((v) => !v)}
          >
            {showAllStatus ? (
              <ChevronUp className="mr-1 size-4" />
            ) : (
              <ChevronDown className="mr-1 size-4" />
            )}
            {showAllStatus ? "提出状況を閉じる" : "提出状況を確認する"}
          </Button>
        </CardContent>
        {showAllStatus && (
        <CardContent className="space-y-3 border-t pt-4">
          {sortedTutors.map((t) => {
            const status = t.submission?.status ?? "未提出";
            const badge = statusBadgeProps(status);
            // 11/18 本人: 凍結は使わないのでボタンを外した。前に凍結した提出が
            // 残っていたときに戻せるよう、解除だけは残す
            const canUnfreeze =
              t.submission && t.submission.status === "frozen";
            return (
              <div
                key={t.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3",
                  !isMatch(t) && "opacity-40",
                )}
              >
                <div className="min-w-[10rem] flex-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <TrackDot track={t.track} />
                    {t.displayName}
                  </div>
                  <div className="text-xs text-muted-foreground">{t.email}</div>
                </div>
                <Badge variant={badge.variant}>{badge.label}</Badge>
                {t.submission && (
                  <div className="text-xs text-muted-foreground">
                    希望: 週 {t.submission.desiredSlots ?? "-"} コマ
                    {t.submission.effectiveTo && (
                      <> ・終了 {t.submission.effectiveTo}</>
                    )}
                    {t.submission.submittedAt && (
                      <> ・提出 {fmtJst(t.submission.submittedAt)}</>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  {canUnfreeze && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        handleFreeze(t.id, t.submission!.effectiveFrom, false)
                      }
                    >
                      <ThermometerSnowflake className="mr-1 h-4 w-4" />
                      凍結解除 (下書きへ)
                    </Button>
                  )}
                </div>
                {t.submission && t.submission.preferredStudents.length > 0 && (
                  <p className="mt-1 w-full text-xs text-muted-foreground">
                    担当したい生徒:{" "}
                    {formatPreferredStudents(t.submission.preferredStudents)}
                  </p>
                )}
                {t.submission?.note && (
                  <p className="mt-1 w-full whitespace-pre-wrap text-xs text-muted-foreground">
                    📝 {t.submission.note}
                  </p>
                )}
              </div>
            );
          })}
          {tutors.length === 0 && (
            <p className="text-sm text-muted-foreground">
              アクティブな講師がいません。
            </p>
          )}
        </CardContent>
        )}
      </Card>

      {/* 本番チェック メモ10・27: 今の Excel「スケジュール」シートと同じく、
          曜日×コマの表に出られる講師を並べ、押して確定する。横に講師ごとの
          「確定 ÷ 出られる」の % を出し、偏りを見ながら組めるようにする */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            出られる人と確定 ({formatMonth(targetMonth)})
          </CardTitle>
          <CardDescription>
            各マスに、そのコマに出られると出した講師が並びます（白＝○、オレンジ＝△ できれば避けたい）。名前を押すと確定（✓）、もう一度押すと外れます。右の % は講師ごとの「確定したコマ ÷ 出られるコマ（○と△）」です。決め終わったら下の「保存」を押してください。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] table-fixed border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="w-16 border bg-muted/50 p-1.5 text-left font-medium">
                      コマ
                    </th>
                    {INPUT_WEEKDAYS.map((w) => (
                      <th
                        key={w.key}
                        className={cn(
                          "border p-1.5 font-semibold",
                          WEEKDAY_HEAD_TONE[w.key],
                        )}
                      >
                        {w.label}
                        <span className="ml-1 font-normal text-muted-foreground">
                          {confirmedCountByWeekday.get(w.key)
                            ? `✓${confirmedCountByWeekday.get(w.key)}`
                            : ""}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <tr key={slot.slotNumber}>
                      <th className="border bg-muted/30 p-1.5 text-left align-top font-medium">
                        {slot.label}
                        <div className="font-normal text-muted-foreground">
                          {slot.startTime}
                        </div>
                      </th>
                      {INPUT_WEEKDAYS.map((w) => (
                        <ScheduleCell
                          key={w.key}
                          weekday={w.key}
                          slot={slot}
                          tutors={sortedTutors}
                          entryMaps={entryMaps}
                          confirmedSet={confirmedSet}
                          disabled={isPending}
                          onToggle={toggleConfirmed}
                          isMatch={isMatch}
                          filterOn={filterOn}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {tutors.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  講師がいないため表示できるものがありません。
                </p>
              )}
            </div>

            <RateList rates={rates} isMatch={isMatch} />
          </div>

          <div className="space-y-3 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="space-y-1">
              <Button
                variant="outline"
                size="sm"
                onClick={bulkConfirmAllSubmittedYes}
                disabled={isPending || tutors.length === 0}
              >
                提出済みの ○ をまとめて確定にする
              </Button>
              <p className="text-xs text-muted-foreground">
                全曜日の、提出済みの人の ○ をすべて ✓ にします。そこから外したい人を押して直すと早いです。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {period && (
                <Button
                  onClick={handleSaveRegularConfirmation}
                  disabled={isPending}
                  className={cn(confirmDirty && "ring-2 ring-primary/40")}
                >
                  <Check className="mr-1 h-4 w-4" />
                  期の全部の月に保存（{confirmedSet.size} 枠）
                </Button>
              )}
              <Button
                variant={period ? "outline" : "default"}
                onClick={handleSaveConfirmation}
                disabled={isPending}
                className={cn(confirmDirty && "ring-2 ring-primary/40")}
              >
                <Check className="mr-1 h-4 w-4" />
                {formatMonth(targetMonth)}だけ保存
              </Button>
              {confirmDirty && (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  まだ保存していない変更があります
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {period
                ? `ふつうは「期の全部の月に保存」です（${period.label}: ${period.startDate} 〜 ${period.endDate} のどの月も同じ確定になります）。この月だけ違うときに「${formatMonth(targetMonth)}だけ保存」を使います。`
                : "この月を含む期がまだ無いため、保存できません。先に「レギュラー期間」で期を作ってください。"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** 曜日の見出しの色 (Excel の色分けに合わせる) */
const WEEKDAY_HEAD_TONE: Record<string, string> = {
  mon: "bg-rose-50 dark:bg-rose-950/40",
  tue: "bg-orange-50 dark:bg-orange-950/40",
  wed: "bg-sky-50 dark:bg-sky-950/40",
  thu: "bg-emerald-50 dark:bg-emerald-950/40",
  fri: "bg-amber-50 dark:bg-amber-950/40",
  sat: "bg-indigo-50 dark:bg-indigo-950/40",
};

/** メモ27: 表の 1 マス。○・△・希望外で確定した人を名前のボタンで縦に並べる */
function ScheduleCell({
  weekday,
  slot,
  tutors,
  entryMaps,
  confirmedSet,
  disabled,
  onToggle,
  isMatch,
  filterOn,
}: {
  weekday: string;
  slot: Slot;
  tutors: TutorView[];
  entryMaps: Map<string, Map<string, "yes" | "maybe" | "no">>;
  confirmedSet: Set<string>;
  disabled: boolean;
  onToggle: (tutorId: string, weekday: string, slot: number) => void;
  isMatch: (t: TutorView) => boolean;
  filterOn: boolean;
}) {
  const cellKey = `${weekday}:${slot.slotNumber}`;
  const isOn = (t: TutorView) =>
    confirmedSet.has(assignKey(t.id, weekday, slot.slotNumber));
  const yes = tutors.filter((t) => entryMaps.get(t.id)?.get(cellKey) === "yes");
  const maybe = tutors.filter(
    (t) => entryMaps.get(t.id)?.get(cellKey) === "maybe",
  );
  const others = tutors.filter((t) => {
    const a = entryMaps.get(t.id)?.get(cellKey);
    return a === undefined || a === "no";
  });
  // 希望に無いのに確定している人 (手で入れた等) も見せる
  const confirmedOthers = others.filter(isOn);
  const addable = others.filter((t) => !isOn(t));
  const people: Array<{ t: TutorView; tone: "yes" | "maybe" | "other" }> = [
    ...yes.map((t) => ({ t, tone: "yes" as const })),
    ...maybe.map((t) => ({ t, tone: "maybe" as const })),
    ...confirmedOthers.map((t) => ({ t, tone: "other" as const })),
  ];
  return (
    <td className="border p-1 align-top">
      <div className="flex flex-col gap-0.5">
        {people.map(({ t, tone }) => {
          const on = isOn(t);
          const draft = t.submission?.status === "draft";
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(t.id, weekday, slot.slotNumber)}
              title={
                tone === "maybe"
                  ? "△ できれば避けたい"
                  : tone === "other"
                    ? "希望に無いコマです"
                    : draft
                      ? "まだ提出していない下書きの希望です"
                      : undefined
              }
              className={cn(
                "flex w-full items-center gap-1 rounded border px-1.5 py-0.5 text-left text-xs transition-colors disabled:opacity-60",
                !isMatch(t) && "opacity-40",
                on
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : tone === "maybe"
                    ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                    : "border-input bg-background hover:bg-muted",
                tone === "other" && "border-dashed",
              )}
            >
              {on ? <Check className="size-3 shrink-0" /> : <TrackDot track={t.track} />}
              <span className="truncate">{t.displayName}</span>
              {tone === "maybe" && !on && <span className="ml-auto">△</span>}
              {draft && <span className="ml-auto opacity-70">下書</span>}
            </button>
          );
        })}
        {addable.length > 0 && (
          <select
            aria-label={`${slot.label} にほかの講師を入れる`}
            value=""
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value) onToggle(e.target.value, weekday, slot.slotNumber);
            }}
            className="h-6 w-full rounded border border-dashed bg-background px-1 text-[11px] text-muted-foreground"
          >
            <option value="">＋</option>
            {addable.map((t) => (
              <option key={t.id} value={t.id}>
                {filterOn && isMatch(t) ? "● " : ""}
                {t.displayName}
              </option>
            ))}
          </select>
        )}
      </div>
    </td>
  );
}

/** メモ27: 講師ごとの「確定 ÷ 出られる (○と△)」。% の低い順 */
function RateList({
  rates,
  isMatch,
}: {
  rates: Array<{
    tutor: TutorView;
    available: number;
    confirmed: number;
    pct: number | null;
  }>;
  isMatch: (t: TutorView) => boolean;
}) {
  return (
    <div className="space-y-2 xl:sticky xl:top-4 xl:self-start">
      <p className="text-sm font-medium">講師ごとの確定の割合</p>
      <p className="text-xs text-muted-foreground">
        確定したコマ ÷ 出られるコマ（○と△）。低い順。
      </p>
      <ul className="space-y-1.5">
        {rates.map(({ tutor, available, confirmed, pct }) => (
          <li
            key={tutor.id}
            className={cn("space-y-0.5", !isMatch(tutor) && "opacity-40")}
          >
            <div className="flex items-baseline gap-1.5 text-xs">
              <TrackDot track={tutor.track} />
              <span className="truncate font-medium">{tutor.displayName}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                {confirmed}/{available}
              </span>
              <span className="w-10 text-right font-semibold tabular-nums">
                {pct === null ? "—" : `${pct}%`}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
              />
            </div>
          </li>
        ))}
        {rates.length === 0 && (
          <li className="text-xs text-muted-foreground">講師がいません。</li>
        )}
      </ul>
    </div>
  );
}
