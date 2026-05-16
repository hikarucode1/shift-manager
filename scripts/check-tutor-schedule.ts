/**
 * getTutorWeekSchedule の動作確認。
 * アップロード済みサンプル週 (2026-04-20〜04-26) で、指定講師のスケジュールを整形して表示。
 *
 * Usage: tsx scripts/check-tutor-schedule.ts [tutorDisplayName]
 */

import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { profiles } from "../src/db/schema";
import { getTutorWeekSchedule } from "../src/lib/tutor-schedule";
import { weekOf } from "../src/lib/week";

const name = process.argv[2] ?? "山本美里";

async function main() {
  const rows = await db
    .select({ id: profiles.id, displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.displayName, name))
    .limit(1);

  if (rows.length === 0) {
    console.error(`profile not found: ${name}`);
    process.exit(1);
  }
  const tutor = rows[0];

  // 引数 --april で旧サンプル週、デフォルトは JST 今週
  const range = process.argv.includes("--april")
    ? { start: "2026-04-20", end: "2026-04-26" }
    : weekOf();
  const schedule = await getTutorWeekSchedule(tutor.id, range);

  console.log(`=== ${tutor.displayName} / ${range.start}〜${range.end} ===`);
  console.log(`hasAnyShift: ${schedule.hasAnyShift}\n`);

  for (const day of schedule.days) {
    const head = `${day.date} (${day.weekdayLabel})`;
    if (day.slots.length === 0) {
      console.log(`${head}  — 出勤なし`);
      continue;
    }
    console.log(head);
    for (const s of day.slots) {
      const seat = s.seatNumber ? ` 座${s.seatNumber}` : "";
      const studs =
        s.students.map((x) => `${x.name}(${x.subject})`).join(", ") || "生徒なし";
      console.log(`  ${s.label} ${s.startTime}〜${s.endTime}${seat}: ${studs}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
