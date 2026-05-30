import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  fixedShifts,
  fixedShiftSubmissions,
  monthlyRegularAssignments,
  monthlySubmissionPeriods,
  slotDefinitions,
} from "@/db/schema";
import { DEFAULT_SLOTS, type InputWeekday } from "@/lib/shift-constants";
import {
  FixedShiftEditor,
  type FixedShiftSubmissionMeta,
} from "./fixed-shift-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function todayIso() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** 当月の 1 日 (JST) を "YYYY-MM-DD" で返す。target_month (月初固定) との比較用 */
function thisMonthIso(): string {
  return `${todayIso().slice(0, 7)}-01`;
}

/** "2026-07-01" → "2026年7月" */
function formatTargetMonth(iso: string): string {
  const [y, m] = iso.split("-");
  return `${Number(y)}年${Number(m)}月`;
}

export default async function FixedShiftPage() {
  const { profile } = await requireRole("tutor");
  const today = todayIso();
  const thisMonth = thisMonthIso();
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
    // Issue #60: 現在受付中の月別提出期間を取得 (target_month 降順、先頭をバナー表示)
    db
      .select({
        id: monthlySubmissionPeriods.id,
        targetMonth: monthlySubmissionPeriods.targetMonth,
        submissionOpensAt: monthlySubmissionPeriods.submissionOpensAt,
        submissionDueAt: monthlySubmissionPeriods.submissionDueAt,
      })
      .from(monthlySubmissionPeriods)
      .where(
        and(
          eq(monthlySubmissionPeriods.isArchived, false),
          lte(monthlySubmissionPeriods.submissionOpensAt, now),
          gte(monthlySubmissionPeriods.submissionDueAt, now),
        ),
      )
      .orderBy(desc(monthlySubmissionPeriods.targetMonth))
      .limit(1),
    // C2 #63: 自分の確定済みレギュラー枠 (当月以降の対象月分)。editor で
    // 「確定済み」表示 (read-only バッジ) するために渡す。targetMonth は月初
    // 固定 (DB CHECK) なので、当月の 2 日目以降に当月分が漏れないよう、比較は
    // today ではなく当月初 (thisMonth) を使う。
    db
      .select({
        targetMonth: monthlyRegularAssignments.targetMonth,
        weekday: monthlyRegularAssignments.weekday,
        slotNumber: monthlyRegularAssignments.slotNumber,
      })
      .from(monthlyRegularAssignments)
      .where(
        and(
          eq(monthlyRegularAssignments.tutorId, profile.id),
          gte(monthlyRegularAssignments.targetMonth, thisMonth),
        ),
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
  // サーバアクション側 (actions.ts:fetchPeriodDeadline) でも同じ境界で拒否される。
  let isPastDeadline = false;
  if (submissionRow && latestEffectiveFrom) {
    const targetMonthIso = `${latestEffectiveFrom.slice(0, 7)}-01`;
    const dueRows = await db
      .select({ submissionDueAt: monthlySubmissionPeriods.submissionDueAt })
      .from(monthlySubmissionPeriods)
      .where(
        and(
          eq(monthlySubmissionPeriods.targetMonth, targetMonthIso),
          eq(monthlySubmissionPeriods.isArchived, false),
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
              <span className="font-medium">
                {formatTargetMonth(activePeriod.targetMonth)}分の提出
              </span>
            </div>
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

      {/* C2 #63: 自分の確定済みレギュラー枠 (read-only) */}
      {confirmedRows.length > 0 && (
        <Card className="border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30">
          <CardHeader>
            <CardTitle className="text-base">確定済みレギュラー</CardTitle>
            <CardDescription>
              教室長が確定した出勤枠です。希望提出と異なる場合があります。詳細は教室長にお問い合わせください。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {Array.from(
              confirmedRows.reduce((acc, r) => {
                if (!acc.has(r.targetMonth)) acc.set(r.targetMonth, []);
                acc.get(r.targetMonth)!.push(r);
                return acc;
              }, new Map<string, typeof confirmedRows>()),
            ).map(([month, rows]) => (
              <div key={month}>
                <div className="font-medium">{formatTargetMonth(month)}: {rows.length} 枠</div>
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
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">曜日 × コマ</CardTitle>
          <CardDescription>
            ○ = 出勤可、△ = 出勤可だが避けたい、空欄 = 不可。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FixedShiftEditor
            slots={slots}
            initialEntries={currentEntries}
            /*
              PR #66 Round 3 P1-A: バナーは「現在受付中の target_month」を表示するが、
              save 側は effectiveFrom の月で period を再検索する。既存提出が無い
              新規ユーザでは initialEffectiveFrom = today だと「7月分受付中」バナーが
              出ていても save の紐付け先は 5月分 (未存在) になり periodId=null になる。
              新規入力時に限り activePeriod の targetMonth を初期値にして両者を揃える。
              既存提出ユーザは latestEffectiveFrom を尊重 (本人の編集対象月の継続)。
            */
            initialEffectiveFrom={
              latestEffectiveFrom ?? activePeriod?.targetMonth ?? today
            }
            initialMeta={initialMeta}
          />
        </CardContent>
      </Card>
    </div>
  );
}
