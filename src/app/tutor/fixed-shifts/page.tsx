import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  fixedShifts,
  fixedShiftSubmissions,
  regularShiftPeriods,
  slotDefinitions,
} from "@/db/schema";
import { DEFAULT_SLOTS, type InputWeekday } from "@/lib/shift-constants";
import { jstToday } from "@/lib/week";
import {
  hasCurrentPeriodData,
  resolveSubmissionEffectiveFrom,
  selectPrefillSourceSubmission,
  submissionQueryLowerBound,
} from "@/lib/regular-submission-target";
import {
  FixedShiftEditor,
  type FixedShiftSubmissionMeta,
} from "./fixed-shift-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { deadlineLabel } from "@/lib/deadline";
import {
  closeExpiredGrants,
  getActiveRegularGrant,
  getRegularChangeState,
} from "@/lib/shift-change";
import { pickRegularChangeTarget } from "@/lib/shift-change-rule";
import {
  ChangeRequestCard,
  type ChangeRequestView,
} from "@/components/shift-change/change-request-card";
import {
  parseStoredPreferredStudents,
  type PreferredStudent,
} from "@/lib/preferred-students";

export default async function FixedShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { profile } = await requireRole("tutor");
  // #334: 講習と同じく「期間を選ぶ → 中身を編集」。?period= が無ければ一覧
  const { period: selectedPeriodId } = await searchParams;
  const today = jstToday();
  const now = new Date();
  // #333: 期限が切れていたら閉じる (出し直さなかった下書きは承認前に戻す)
  await closeExpiredGrants(profile.id, now);

  // Issue #72 (β): 現在受付中の期 (regular_shift_periods) を取得する。
  // submissionOpensAt <= now <= submissionDueAt の active な期を 1 件、
  // 期の開始日が新しい順 (= 直近の期) で取る。
  // #156: この期の開始日が「提出対象の起点 (effective_from)」を決めるため、
  // queryFrom に依存しない slots とだけ並行取得し、queryFrom 依存の
  // existing / submissionRows は activePeriod 解決後に別途投げる。
  const [activePeriodRows, slotRows] = await Promise.all([
    db
      .select({
        id: regularShiftPeriods.id,
        label: regularShiftPeriods.label,
        startDate: regularShiftPeriods.startDate,
        endDate: regularShiftPeriods.endDate,
        submissionOpensAt: regularShiftPeriods.submissionOpensAt,
        submissionDueAt: regularShiftPeriods.submissionDueAt,
      })
      .from(regularShiftPeriods)
      .where(
        and(
          eq(regularShiftPeriods.isArchived, false),
          lte(regularShiftPeriods.submissionOpensAt, now),
          gte(regularShiftPeriods.submissionDueAt, now),
        ),
      )
      .orderBy(desc(regularShiftPeriods.startDate))
      .limit(1),
    db
      .select()
      .from(slotDefinitions)
      .where(eq(slotDefinitions.isActive, true))
      .orderBy(asc(slotDefinitions.slotNumber)),
  ]);
  const acceptingPeriod = activePeriodRows[0] ?? null;

  // #333: 受付中の期が無いときは、教室長が承認した変更申請の期をその講師だけ
  // 受付中として扱う (サーバー側 actions.ts の resolveEditablePeriod と同じ)
  const [grant, changeState] = acceptingPeriod
    ? [null, null]
    : await Promise.all([
        getActiveRegularGrant(profile.id, now),
        getRegularChangeState(profile.id, now),
      ]);
  // 受付中の期が無いとき: 許可された期、無ければ変更申請の対象になる期
  // (pickRegularChangeTarget) を表示する。締切後でも、自分が出した中身を
  // 見られるように (編集できるかは editableNow で別に決める)
  type PeriodRow = (typeof activePeriodRows)[number];
  let grantPeriod: PeriodRow | null = null;
  let viewPeriod: PeriodRow | null = null;
  if (!acceptingPeriod) {
    const rows = await db
      .select({
        id: regularShiftPeriods.id,
        label: regularShiftPeriods.label,
        startDate: regularShiftPeriods.startDate,
        endDate: regularShiftPeriods.endDate,
        submissionOpensAt: regularShiftPeriods.submissionOpensAt,
        submissionDueAt: regularShiftPeriods.submissionDueAt,
      })
      .from(regularShiftPeriods)
      .where(eq(regularShiftPeriods.isArchived, false));
    grantPeriod = grant?.regularPeriodId
      ? (rows.find((r) => r.id === grant.regularPeriodId) ?? null)
      : null;
    viewPeriod = grantPeriod ?? pickRegularChangeTarget(rows, now);
  }
  const activePeriod = acceptingPeriod ?? viewPeriod;
  // #333: 受付中の期も、使える変更の許可も無ければ編集させない (以前は期の
  // 無い日付なら自由に保存できた)。期のない状態で承認された許可は通す
  const editableNow =
    acceptingPeriod !== null ||
    grantPeriod !== null ||
    (grant !== null && grant.regularPeriodId === null);

  // #334: 期間の一覧。受付中の期 (無ければ許可された期・変更申請の対象の期) を
  // カードで出し、タップで編集画面へ。期がまったく無いときは今まで通り編集画面
  if (activePeriod && selectedPeriodId !== activePeriod.id) {
    const dueDate = jstToday(activePeriod.submissionDueAt);
    const daysLeft = Math.round(
      (Date.parse(dueDate) - Date.parse(today)) / 86_400_000,
    );
    const dl = deadlineLabel(daysLeft);
    return (
      <div className="space-y-5">
        <section className="rounded-xl bg-primary p-4 text-primary-foreground">
          <h1 className="text-xl font-bold">レギュラーシフト提出</h1>
          <p className="mt-1 text-xs text-primary-foreground/80">
            期間を選んで、毎週出勤できるコマを登録します。締切までは何度でも変更できます。
          </p>
        </section>

        <div className="grid gap-3">
          <Link href={`/tutor/fixed-shifts?period=${activePeriod.id}`}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="text-base">{activePeriod.label}</CardTitle>
                  <CardDescription>
                    {activePeriod.startDate} 〜 {activePeriod.endDate} ／ 締切{" "}
                    {activePeriod.submissionDueAt.toLocaleDateString("ja-JP", {
                      timeZone: "Asia/Tokyo",
                    })}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {acceptingPeriod ? (
                    <Badge variant={dl.urgent ? "accent" : "secondary"}>
                      {dl.text}
                    </Badge>
                  ) : editableNow ? (
                    <Badge variant="accent">変更できます</Badge>
                  ) : (
                    <Badge variant="outline">締切終了</Badge>
                  )}
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    );
  }
  const changeView: ChangeRequestView | null = acceptingPeriod
    ? null
    : changeState?.kind === "approved"
      ? { kind: "approved", unlockedUntil: changeState.unlockedUntil.toISOString() }
      : changeState?.kind === "pending"
        ? { kind: "pending", id: changeState.id }
        : changeState?.kind === "rejected"
          ? { kind: "rejected", decisionNote: changeState.decisionNote }
          : { kind: "none" };

  // #156: 既存提出/シフトの復元クエリ下限。通常は today だが、受付中の期の開始日が
  // 過去日 (期の開始後の遅れ提出) の場合は期初まで下げて取りこぼしを防ぐ。
  const queryFrom = submissionQueryLowerBound({
    activePeriodStartDate: activePeriod?.startDate ?? null,
    today,
  });

  const [existing, submissionRows] = await Promise.all([
    db
      .select({
        weekday: fixedShifts.weekday,
        slotNumber: fixedShifts.slotNumber,
        effectiveFrom: fixedShifts.effectiveFrom,
        availability: fixedShifts.availability,
      })
      .from(fixedShifts)
      .where(
        and(
          eq(fixedShifts.tutorId, profile.id),
          gte(fixedShifts.effectiveFrom, queryFrom),
        ),
      ),
    db
      .select({
        effectiveFrom: fixedShiftSubmissions.effectiveFrom,
        effectiveTo: fixedShiftSubmissions.effectiveTo,
        desiredDays: fixedShiftSubmissions.desiredDays,
        desiredSlots: fixedShiftSubmissions.desiredSlots,
        note: fixedShiftSubmissions.note,
        preferredStudents: fixedShiftSubmissions.preferredStudents,
        status: fixedShiftSubmissions.status,
        submittedAt: fixedShiftSubmissions.submittedAt,
      })
      .from(fixedShiftSubmissions)
      .where(
        and(
          eq(fixedShiftSubmissions.tutorId, profile.id),
          gte(fixedShiftSubmissions.effectiveFrom, queryFrom),
        ),
      ),
  ]);

  const slots =
    slotRows.length > 0
      ? slotRows.map((s) => ({
          slotNumber: s.slotNumber,
          label: s.label,
          startTime: s.startTime,
          endTime: s.endTime,
        }))
      : DEFAULT_SLOTS.map((s) => ({ ...s }));

  // 既存の設定があれば最新の effectiveFrom を取り出す。
  // shifts とメタ両方を見ないと、entries 空 (全コマ不可) でメタだけ提出した
  // ケースが復元されない (#65 P1)。
  const allEffectiveFromDates: string[] = [
    ...existing.map((r) => r.effectiveFrom),
    ...submissionRows.map((r) => r.effectiveFrom),
  ];
  const latestEffectiveFrom =
    allEffectiveFromDates.length > 0
      ? allEffectiveFromDates.reduce((acc, d) => (d > acc ? d : acc))
      : null;

  // #156: 提出対象の起点 (effective_from)。受付中の期があれば必ずその期の開始日に
  // 固定する。これを既存提出の復元キーと保存の起点 (initialEffectiveFrom) の両方に
  // 使うことで、「表示は latestEffectiveFrom・保存は別の月」というズレを断つ。
  const targetEffectiveFrom = resolveSubmissionEffectiveFrom({
    activePeriodStartDate: activePeriod?.startDate ?? null,
    latestEffectiveFrom,
    today,
  });

  // アクティブなコマ番号。無効化済みコマの行は編集グリッドに描画できず、
  // 初期値に混ぜると「見えないが保存される」幽霊行になるため除外する (#161 レビュー)。
  const activeSlotNumbers = new Set(slots.map((s) => s.slotNumber));

  // fixed_shifts 行 → 編集可能エントリへの変換 (currentEntries / prefill 共通)。
  // Issue #55/#56: sun は入力対象外、no は行不在で表現するため除外。
  const toEditableEntries = (
    rows: { weekday: string; slotNumber: number; availability: string }[],
  ) =>
    rows
      .filter(
        (r) =>
          r.weekday !== "sun" &&
          r.availability !== "no" &&
          activeSlotNumbers.has(r.slotNumber),
      )
      .map((r) => ({
        weekday: r.weekday as InputWeekday,
        slotNumber: r.slotNumber,
        availability: r.availability as "yes" | "maybe",
      }));

  const currentPeriodRows = existing.filter(
    (r) => r.effectiveFrom === targetEffectiveFrom,
  );
  const currentEntries = toEditableEntries(currentPeriodRows);

  // 提出単位メタ (Issue #57/#58/#59) は fixed_shift_submissions 側に全て寄せている。
  // 当初 effective_to は fixed_shifts 側だったが、entries 空 (全コマ不可) のとき
  // shifts 行が消えて終了日が復元できなくなる PR #65 レビュー指摘で submissions に移管。
  const submissionRow = submissionRows.find(
    (r) => r.effectiveFrom === targetEffectiveFrom,
  );

  // Issue #61 / PR #67 P1 #2: 締切超過は UI 上 frozen 表示に上書きする。
  // DB 状態 (draft/submitted) は触らないがフォームを完全 read-only にし、保存・提出ボタンを隠す。
  // サーバアクション側 (actions.ts の windowBlockReason) でも同じ境界で拒否される。
  // #333: 受付中の期も変更の許可も無いとき (締切後・期の外) はすべて read-only
  const isPastDeadline = !editableNow;
  // #161: 新しい期を開いた直後 (当期のデータが一切ない) は、前期の提出内容を
  // プリフィルする。表示のみの初期値で、保存時はサーバーが当期の期初を強制する
  // (#160 の不変条件は維持)。
  //
  // 前期の特定は fixed_shifts 行の max ではなく「提出単位 (fixed_shift_submissions)」
  // で行う: そうしないと (a) 全コマ不可のメタのみ提出を飛ばして古い期を拾う、
  // (b) 期に紐づかないアドホック行を前期と誤認する (#161 レビュー)。
  let prefill: {
    entries: typeof currentEntries;
    desiredDays: number | null;
    desiredSlots: number | null;
    preferredStudents: PreferredStudent[];
    sourceFrom: string;
  } | null = null;
  const currentDataExists = hasCurrentPeriodData({
    hasSubmissionRow: submissionRow != null,
    hasAnyRawFixedShiftRow: currentPeriodRows.length > 0,
  });
  if (activePeriod && !currentDataExists) {
    // 前期の提出候補とその fixed_shifts 行を 1 回の Promise.all で並行取得
    const [prevSubs, prevShiftRows] = await Promise.all([
      db
        .select({
          effectiveFrom: fixedShiftSubmissions.effectiveFrom,
          effectiveTo: fixedShiftSubmissions.effectiveTo,
          desiredDays: fixedShiftSubmissions.desiredDays,
          desiredSlots: fixedShiftSubmissions.desiredSlots,
          preferredStudents: fixedShiftSubmissions.preferredStudents,
        })
        .from(fixedShiftSubmissions)
        .where(
          and(
            eq(fixedShiftSubmissions.tutorId, profile.id),
            lt(fixedShiftSubmissions.effectiveFrom, targetEffectiveFrom),
          ),
        )
        .orderBy(desc(fixedShiftSubmissions.effectiveFrom))
        .limit(12),
      db
        .select({
          effectiveFrom: fixedShifts.effectiveFrom,
          weekday: fixedShifts.weekday,
          slotNumber: fixedShifts.slotNumber,
          availability: fixedShifts.availability,
        })
        .from(fixedShifts)
        .where(
          and(
            eq(fixedShifts.tutorId, profile.id),
            lt(fixedShifts.effectiveFrom, targetEffectiveFrom),
          ),
        ),
    ]);
    const source = selectPrefillSourceSubmission({
      candidates: prevSubs,
      targetEffectiveFrom,
    });
    if (source) {
      const entries = toEditableEntries(
        prevShiftRows.filter((r) => r.effectiveFrom === source.effectiveFrom),
      );
      // entries 空 = 前期が全コマ不可 (メタのみ) の提出。引き継ぐ内容が無いので
      // プリフィルしない (= 本人の「出られない」意思を尊重し空フォームにする)。
      if (entries.length > 0) {
        prefill = {
          entries,
          desiredDays: source.desiredDays,
          desiredSlots: source.desiredSlots,
          // #319: 担当は期をまたいで続くことが多いので引き継ぐ
          preferredStudents: parseStoredPreferredStudents(
            prevSubs.find((p) => p.effectiveFrom === source.effectiveFrom)
              ?.preferredStudents,
          ),
          sourceFrom: source.effectiveFrom,
        };
      }
    }
  }

  const dbStatus = submissionRow?.status ?? "none";
  const initialMeta: FixedShiftSubmissionMeta = {
    effectiveTo: submissionRow?.effectiveTo ?? null,
    // #161: プリフィル時は希望日数/コマ数も前期値を初期表示 (note と終了日は
    // 期固有の内容になりがちなので引き継がない)
    desiredDays: submissionRow?.desiredDays ?? prefill?.desiredDays ?? null,
    desiredSlots: submissionRow?.desiredSlots ?? prefill?.desiredSlots ?? null,
    note: submissionRow?.note ?? null,
    // #319: 当期の行があればそれ (空でも本人が消した結果なので前期で埋めない)
    preferredStudents: submissionRow
      ? parseStoredPreferredStudents(submissionRow.preferredStudents)
      : (prefill?.preferredStudents ?? []),
    status: isPastDeadline ? "frozen" : dbStatus,
    submittedAt: submissionRow?.submittedAt
      ? submissionRow.submittedAt.toISOString()
      : null,
  };

  // navy ヘッダー用: 受付中の期があれば締切までの残り日数を算出 (JST カレンダー日基準)
  // #333: 締切は受付中の期だけ出す (締切後に許可で直しているときは、
  // 変更申請のカードに期限を出す)
  const headerDeadline = acceptingPeriod
    ? (() => {
        const dueDate = jstToday(acceptingPeriod.submissionDueAt);
        const daysLeft = Math.round(
          (Date.parse(dueDate) - Date.parse(today)) / 86_400_000,
        );
        return {
          ...deadlineLabel(daysLeft),
          dueAt: acceptingPeriod.submissionDueAt,
        };
      })()
    : null;

  return (
    <div className="space-y-5">
      {activePeriod && (
        <Link
          href="/tutor/fixed-shifts"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          ← レギュラー期間の一覧へ
        </Link>
      )}
      {/* ネイビー hero: 期間名 + タイトル + 締切 (#130 と統一) */}
      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <p className="text-xs text-primary-foreground/70">
          {activePeriod ? activePeriod.label : "通常期間"}
        </p>
        <h1 className="mt-0.5 text-xl font-bold">レギュラーシフト提出</h1>
        <p className="mt-1 text-xs text-primary-foreground/80">
          出勤できるコマをタップして登録します
        </p>
        {headerDeadline && (
          <p className="mt-2 text-sm">
            <span className="text-primary-foreground/70">締切 </span>
            <span
              className={cn(
                "font-semibold",
                headerDeadline.urgent
                  ? "text-accent"
                  : "text-primary-foreground",
              )}
            >
              {headerDeadline.dueAt.toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
              （{headerDeadline.text}）
            </span>
          </p>
        )}
      </section>

      {/* #333: 提出期間の外は「変更申請」から */}
      {changeView && (
        <ChangeRequestCard target={{ kind: "regular" }} state={changeView} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">曜日 × コマ</CardTitle>
          <CardDescription>
            出勤できるコマをタップして登録します。締切までは何度でも修正できます。
          </CardDescription>
        </CardHeader>
        <CardContent className="max-sm:px-3">
          <FixedShiftEditor
            slots={slots}
            initialEntries={prefill ? prefill.entries : currentEntries}
            prefilledFrom={prefill?.sourceFrom ?? null}
            /*
              Issue #72 (β) / #156: 期単位提出。受付中の期があれば必ずその期の
              開始日を起点にする (resolveSubmissionEffectiveFrom)。復元キーと同一の
              targetEffectiveFrom を渡すことで、表示と保存先のズレを防ぐ。
              期に紐づくときは periodLocked=true にして起点を編集不可にする。
            */
            initialEffectiveFrom={targetEffectiveFrom}
            initialMeta={initialMeta}
            periodLocked={activePeriod != null}
            periodLabel={activePeriod?.label ?? null}
            periodEndDate={activePeriod?.endDate ?? null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
