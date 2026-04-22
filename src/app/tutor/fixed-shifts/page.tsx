import { and, asc, eq, gte } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { fixedShifts, slotDefinitions } from "@/db/schema";
import { DEFAULT_SLOTS } from "@/lib/shift-constants";
import { FixedShiftEditor } from "./fixed-shift-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function todayIso() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export default async function FixedShiftPage() {
  const { profile } = await requireRole("tutor");
  const today = todayIso();

  const [slotRows, existing] = await Promise.all([
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
      })
      .from(fixedShifts)
      .where(
        and(
          eq(fixedShifts.tutorId, profile.id),
          gte(fixedShifts.effectiveFrom, today),
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

  // 既存の設定があれば最新の effectiveFrom を取り出す
  const latestEffectiveFrom =
    existing.length > 0
      ? existing.reduce(
          (acc, row) => (row.effectiveFrom > acc ? row.effectiveFrom : acc),
          existing[0].effectiveFrom,
        )
      : null;

  const currentEntries = latestEffectiveFrom
    ? existing
        .filter((r) => r.effectiveFrom === latestEffectiveFrom)
        .map((r) => ({ weekday: r.weekday, slotNumber: r.slotNumber }))
    : [];

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
            チェックを付けた枠が「勤務可能」として扱われます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FixedShiftEditor
            slots={slots}
            initialEntries={currentEntries}
            initialEffectiveFrom={latestEffectiveFrom ?? today}
          />
        </CardContent>
      </Card>
    </div>
  );
}
