import { readFileSync } from "node:fs";
import { parseShiftCsvBuffer } from "../src/lib/shift-csv-parser";

const path = process.argv[2];
if (!path) {
  console.error("Usage: tsx scripts/test-parser.ts <path-to-csv>");
  process.exit(1);
}

const buf = readFileSync(path);
const parsed = parseShiftCsvBuffer(buf);

console.log("=== Summary ===");
console.log("Week:", parsed.weekStart, "〜", parsed.weekEnd);
console.log(
  "Active trainings:",
  parsed.activeTrainings.map((t) => `${t.name} (${t.startDate}〜${t.endDate})`),
);
console.log("Unique teachers:", parsed.uniqueTeacherNames.length);
console.log("Unique students:", parsed.uniqueStudentNames.length);
console.log();

for (const day of parsed.days) {
  const count = day.slots.reduce((a, s) => a + s.assignments.length, 0);
  console.log(
    `${day.date} (${day.weekday})${day.isHoliday ? " [休日]" : ""} — ${day.slots.length} slots, ${count} 出勤`,
  );
  for (const slot of day.slots) {
    if (slot.assignments.length === 0) continue;
    console.log(`  ${slot.label} (${slot.startTime}〜${slot.endTime})`);
    for (const a of slot.assignments) {
      const seat = a.seatNumber ?? "-";
      const students = a.students
        .map((s) => `${s.name}(${s.subject})`)
        .join(", ");
      console.log(`    [座${seat}] ${a.teacherName}: ${students}`);
    }
  }
}

console.log();
console.log("=== Teachers ===");
console.log(parsed.uniqueTeacherNames.join(", "));
console.log();
console.log("=== Students (first 20) ===");
console.log(parsed.uniqueStudentNames.slice(0, 20).join(", "));
