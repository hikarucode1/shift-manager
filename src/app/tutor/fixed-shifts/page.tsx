import { and, asc, eq, gte } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  fixedShifts,
  fixedShiftSubmissions,
  slotDefinitions,
} from "@/db/schema";
import { DEFAULT_SLOTS, type InputWeekday } from "@/lib/shift-constants";
import {
  FixedShiftEditor,
  type FixedShiftSubmissionMeta,
} from "./fixed-shift-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function todayIso() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export default async function FixedShiftPage() {
  const { profile } = await requireRole("tutor");
  const today = todayIso();

  const [slotRows, existing, submissionRows] = await Promise.all([
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
        effectiveTo: fixedShifts.effectiveTo,
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
        desiredDays: fixedShiftSubmissions.desiredDays,
        desiredSlots: fixedShiftSubmissions.desiredSlots,
        note: fixedShiftSubmissions.note,
      })
      .from(fixedShiftSubmissions)
      .where(
        and(
          eq(fixedShiftSubmissions.tutorId, profile.id),
          gte(fixedShiftSubmissions.effectiveFrom, today),
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

  // 提出単位メタ。fixed_shifts に effective_to を持たせる設計 (Issue #58)
  // なので、メタの effective_to は当該 effective_from のシフト行から拾う。
  const submissionRow = latestEffectiveFrom
    ? submissionRows.find((r) => r.effectiveFrom === latestEffectiveFrom)
    : undefined;
  const effectiveToFromShifts = latestEffectiveFrom
    ? existing.find(
        (r) =>
          r.effectiveFrom === latestEffectiveFrom && r.effectiveTo != null,
      )?.effectiveTo ?? null
    : null;
  const initialMeta: FixedShiftSubmissionMeta = {
    effectiveTo: effectiveToFromShifts,
    desiredDays: submissionRow?.desiredDays ?? null,
    desiredSlots: submissionRow?.desiredSlots ?? null,
    note: submissionRow?.note ?? null,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">固定シフト登録</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          通常期間に毎週入れる勤務可能枠を設定します。保存すると、指定日以降の毎週に自動で適用されます。
        </p>
      </div>

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
            initialEffectiveFrom={latestEffectiveFrom ?? today}
            initialMeta={initialMeta}
          />
        </CardContent>
      </Card>
    </div>
  );
}
