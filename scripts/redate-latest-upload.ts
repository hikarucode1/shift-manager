/**
 * ⚠️ 開発/テスト専用。
 * 直近 upload の weekly_shifts を「今週(JST)」に平行移動する。
 * 時間相対な画面 (講師の今週シフト等) をブラウザで確認するための治具。
 *
 * 元の日付には戻せない (再アップロードで復旧する想定)。本番 DB で実行しないこと。
 *
 * Usage: tsx scripts/redate-latest-upload.ts
 */

import { asc, desc, eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { shiftUploads, weeklyShifts } from "../src/db/schema";
import { weekOf } from "../src/lib/week";

function diffDays(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T12:00:00Z`).getTime();
  const b = new Date(`${toIso}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const [upload] = await db
    .select()
    .from(shiftUploads)
    .orderBy(desc(shiftUploads.createdAt))
    .limit(1);

  if (!upload) {
    console.error("shift_uploads が空です。先に CSV をアップロードしてください。");
    process.exit(1);
  }

  const thisWeek = weekOf();
  const shift = diffDays(upload.weekStart, thisWeek.start);

  if (shift === 0) {
    console.log("既に今週です。変更不要。");
    process.exit(0);
  }

  const shifts = await db
    .select({ id: weeklyShifts.id, date: weeklyShifts.date })
    .from(weeklyShifts)
    .where(eq(weeklyShifts.uploadId, upload.id))
    .orderBy(asc(weeklyShifts.date));

  console.log(
    `upload ${upload.id} (${upload.weekStart}〜${upload.weekEnd}) を ${shift} 日ずらして今週へ`,
  );

  await db.transaction(async (tx) => {
    for (const s of shifts) {
      await tx
        .update(weeklyShifts)
        .set({ date: addDays(s.date, shift) })
        .where(eq(weeklyShifts.id, s.id));
    }
    await tx
      .update(shiftUploads)
      .set({
        weekStart: thisWeek.start,
        weekEnd: thisWeek.end,
      })
      .where(eq(shiftUploads.id, upload.id));
  });

  console.log(`✓ 完了: ${thisWeek.start}〜${thisWeek.end} に移動 (${shifts.length} 行)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
