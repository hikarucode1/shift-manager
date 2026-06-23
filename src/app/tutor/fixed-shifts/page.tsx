import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  fixedShifts,
  fixedShiftSubmissions,
  regularAssignments,
  regularShiftPeriods,
  slotDefinitions,
} from "@/db/schema";
import { DEFAULT_SLOTS, type InputWeekday } from "@/lib/shift-constants";
import { jstToday } from "@/lib/week";
import {
  FixedShiftEditor,
  type FixedShiftSubmissionMeta,
} from "./fixed-shift-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function FixedShiftPage() {
  const { profile } = await requireRole("tutor");
  const today = jstToday();
  const now = new Date();

  const [slotRows, existing, submissionRows, activePeriodRows, confirmedRows] = await Promise.all([
    db
      .select()
      .from(slotDefinitions)
      .where(eq(slotDefinitions.isActive, true))
      .orderBy(asc(slotDefinitions.slotNumber)),
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
          gte(fixedShifts.effectiveFrom, today),
        ),
      ),
    db
      .select({
        effectiveFrom: fixedShiftSubmissions.effectiveFrom,
        effectiveTo: fixedShiftSubmissions.effectiveTo,
        desiredDays: fixedShiftSubmissions.desiredDays,
        desiredSlots: fixedShiftSubmissions.desiredSlots,
        note: fixedShiftSubmissions.note,
        status: fixedShiftSubmissions.status,
        submittedAt: fixedShiftSubmissions.submittedAt,
      })
      .from(fixedShiftSubmissions)
      .where(
        and(
          eq(fixedShiftSubmissions.tutorId, profile.id),
          gte(fixedShiftSubmissions.effectiveFrom, today),
        ),
      ),
    // Issue #72 (β): 現在受付中の期 (regular_shift_periods) を取得。
    // submissionOpensAt <= now <= submissionDueAt の active な期を 1 件、
    // 期の開始日が新しい順 (= 直近の期) で取る。
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
    // Issue #74 (δ): 自分の確定済みレギュラー枠 (今日以降に有効な行のみ)。
    // effective_from の早い順 + weekday 順で取り、UI で「期間ごとにグループ化して表示」する。
    db
      .select({
        effectiveFrom: regularAssignments.effectiveFrom,
        effectiveTo: regularAssignments.effectiveTo,
        weekday: regularAssignments.weekday,
        slotNumber: regularAssignments.slotNumber,
      })
      .from(regularAssignments)
      .where(
        and(
          eq(regularAssignments.tutorId, profile.id),
          gte(regularAssignments.effectiveTo, today),
        ),
      )
      .orderBy(
        asc(regularAssignments.effectiveFrom),
        asc(regularAssignments.weekday),
        asc(regularAssignments.slotNumber),
      ),
  ]);
  const activePeriod = activePeriodRows[0] ?? null;

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

  // Issue #55/#56: sun は入力対象外、no は行不在で表現するため除外
  const currentEntries = latestEffectiveFrom
    ? existing
        .filter(
          (r) =>
            r.effectiveFrom === latestEffectiveFrom &&
            r.weekday !== "sun" &&
            r.availability !== "no",
        )
        .map((r) => ({
          weekday: r.weekday as InputWeekday,
          slotNumber: r.slotNumber,
          availability: r.availability as "yes" | "maybe",
        }))
    : [];

  // 提出単位メタ (Issue #57/#58/#59) は fixed_shift_submissions 側に全て寄せている。
  // 当初 effective_to は fixed_shifts 側だったが、entries 空 (全コマ不可) のとき
  // shifts 行が消えて終了日が復元できなくなる PR #65 レビュー指摘で submissions に移管。
  const submissionRow = latestEffectiveFrom
    ? submissionRows.find((r) => r.effectiveFrom === latestEffectiveFrom)
    : undefined;

  // Issue #61 / PR #67 P1 #2: 締切超過は UI 上 frozen 表示に上書きする。
  // DB 状態 (draft/submitted) は触らないがフォームを完全 read-only にし、保存・提出ボタンを隠す。
  // サーバアクション側 (actions.ts:fetchPeriodWindow) でも同じ境界で拒否される。
  // Issue #72 (β): 月別 period から期 (regular_shift_periods) へ参照先変更。
  // effective_from が範囲に含まれる active な期を検索する。
  let isPastDeadline = false;
  if (submissionRow && latestEffectiveFrom) {
    const dueRows = await db
      .select({ submissionDueAt: regularShiftPeriods.submissionDueAt })
      .from(regularShiftPeriods)
      .where(
        and(
          eq(regularShiftPeriods.isArchived, false),
          lte(regularShiftPeriods.startDate, latestEffectiveFrom),
          gte(regularShiftPeriods.endDate, latestEffectiveFrom),
        ),
      )
      .limit(1);
    const due = dueRows[0]?.submissionDueAt;
    if (due && now > due) isPastDeadline = true;
  }
  const dbStatus = submissionRow?.status ?? "none";
  const initialMeta: FixedShiftSubmissionMeta = {
    effectiveTo: submissionRow?.effectiveTo ?? null,
    desiredDays: submissionRow?.desiredDays ?? null,
    desiredSlots: submissionRow?.desiredSlots ?? null,
    note: submissionRow?.note ?? null,
    status: isPastDeadline ? "frozen" : dbStatus,
    submittedAt: submissionRow?.submittedAt
      ? submissionRow.submittedAt.toISOString()
      : null,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">固定シフト登録</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          通常期間に毎週入れる勤務可能枠を設定します。保存すると、指定日以降の毎週に自動で適用されます。
        </p>
      </div>

      {activePeriod && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col gap-1 py-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge>受付中</Badge>
              <span className="font-medium">{activePeriod.label} の提出</span>
            </div>
            <p className="text-xs text-muted-foreground">
              対象期間 {activePeriod.startDate} 〜 {activePeriod.endDate}
            </p>
            <p className="text-xs text-muted-foreground">
              締切{" "}
              {activePeriod.submissionDueAt.toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {" "}まで
            </p>
          </CardContent>
        </Card>
      )}

      {/* Issue #74 (δ): 自分の確定済みレギュラー枠 (期間範囲ごとに表示) */}
      {confirmedRows.length > 0 && (
        <Card className="border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30">
          <CardHeader>
            <CardTitle className="text-base">確定済みレギュラー</CardTitle>
            <CardDescription>
              教室長が確定した出勤枠です。期間 (effective_from 〜 effective_to)
              ごとに表示します。希望提出と異なる場合があります。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {Array.from(
              confirmedRows.reduce((acc, r) => {
                const key = `${r.effectiveFrom}__${r.effectiveTo}`;
                if (!acc.has(key)) acc.set(key, []);
                acc.get(key)!.push(r);
                return acc;
              }, new Map<string, typeof confirmedRows>()),
            ).map(([key, rows]) => {
              const [from, to] = key.split("__");
              return (
                <div key={key}>
                  <div className="font-medium">
                    {from} 〜 {to}: {rows.length} 枠
                  </div>
                  <ul className="ml-4 text-muted-foreground">
                    {rows.map((r) => (
                      <li key={`${r.weekday}:${r.slotNumber}`}>
                        {r.weekday === "mon" && "月"}
                        {r.weekday === "tue" && "火"}
                        {r.weekday === "wed" && "水"}
                        {r.weekday === "thu" && "木"}
                        {r.weekday === "fri" && "金"}
                        {r.weekday === "sat" && "土"} {r.slotNumber}限
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">曜日 × コマ</CardTitle>
          <CardDescription>
            ○ = 出勤可、△ = 出勤可だが避けたい、空欄 = 不可。タップごとに ○ → △ → 空 → ○ … と循環します（△ は空セルから 2 回、○ セルから 1 回）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FixedShiftEditor
            slots={slots}
            initialEntries={currentEntries}
            /*
              Issue #72 (β): 期単位提出。バナーに表示中の期を提出の起点に揃え、
              save 側 (fetchPeriodWindow) が effective_from を含む期を検索して
              period_id を解決できるよう、初期値は期の start_date とする。
              既存提出ユーザは latestEffectiveFrom を尊重して編集を継続。
            */
            initialEffectiveFrom={
              latestEffectiveFrom ?? activePeriod?.startDate ?? today
            }
            initialMeta={initialMeta}
          />
        </CardContent>
      </Card>
    </div>
  );
}
