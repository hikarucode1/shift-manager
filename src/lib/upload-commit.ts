import "server-only";
import { and, arrayContains, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  shiftAssignments,
  shiftUploads,
  students,
  weeklyShifts,
} from "@/db/schema";
import type { ParsedShiftCsv } from "@/lib/shift-csv-parser";
import { findMappingDuplicates } from "@/lib/mapping-validation";

export type TeacherMapping = Record<string, string>; // teacherName → profileId

export type CommitUploadArgs = {
  parsed: ParsedShiftCsv;
  mappings: TeacherMapping;
  rawContent: string;
  originalFilename: string;
  fileBytes: number;
  uploadedBy: string;
};

export type CommitUploadResult = {
  uploadId: string;
  insertedShiftRows: number;
  insertedAssignmentRows: number;
  upsertedStudents: number;
  replacedDateCount: number;
};

/**
 * Persist a parsed CSV to the database and mark the upload as published.
 *
 * Semantics:
 * - `mappings` must cover every name in `parsed.uniqueTeacherNames`
 * - Students are upserted by `name_key` (= name, trimmed)
 * - Any pre-existing weekly_shifts within [weekStart, weekEnd] are deleted
 *   so the new upload fully replaces that week's published data
 * - All writes happen in a single transaction
 */
export async function commitShiftUpload(
  args: CommitUploadArgs,
): Promise<CommitUploadResult> {
  const { parsed, mappings, rawContent, originalFilename, fileBytes, uploadedBy } =
    args;

  // Validate mappings
  const missing = parsed.uniqueTeacherNames.filter((n) => !mappings[n]);
  if (missing.length > 0) {
    throw new Error(
      `講師の対応付けが未完了です: ${missing.join(", ")}`,
    );
  }

  // 判定対象は CSV に実在する講師名のみに限定 (missing チェックと同じ正準ソース)。
  // クライアントが余分/古いキーを送っても誤検出しないようスコープを揃える。
  const scopedMappings: TeacherMapping = {};
  for (const name of parsed.uniqueTeacherNames) {
    scopedMappings[name] = mappings[name];
  }

  // 同一アカウントへの重複割当を拒否 (DB の unique 制約に当たる前に明示エラー)
  const dups = findMappingDuplicates(scopedMappings);
  if (dups.length > 0) {
    const detail = dups
      .map((d) => `「${d.csvNames.join("」「")}」`)
      .join(", ");
    throw new Error(
      `同じ講師アカウントに複数の CSV 名が割り当てられています: ${detail}。1 名につき 1 アカウントにしてください。`,
    );
  }

  // CSV 内で同じ講師が同じ日・同じコマに 2 回以上現れるケースを検出
  // (座席を2つ持つ等)。mapping 重複とは別系統だが weekly_shifts_unique
  // (upload_id, tutor_id, date, slot_number) 違反になるため事前に弾く。
  const seen = new Set<string>();
  const collisions: string[] = [];
  for (const day of parsed.days) {
    if (day.isHoliday) continue;
    for (const slot of day.slots) {
      for (const a of slot.assignments) {
        const tutorId = scopedMappings[a.teacherName];
        if (!tutorId) continue;
        const key = `${day.date}|${slot.slotNumber}|${tutorId}`;
        if (seen.has(key)) {
          collisions.push(
            `${day.date} ${slot.slotNumber}限: ${a.teacherName}`,
          );
        } else {
          seen.add(key);
        }
      }
    }
  }
  if (collisions.length > 0) {
    const uniq = [...new Set(collisions)];
    throw new Error(
      `同じ講師が同じ日・同じコマに重複しています: ${uniq.join(" / ")}。CSV を確認してください。`,
    );
  }

  const studentNames = [...new Set(parsed.uniqueStudentNames.map((n) => n.trim()).filter(Boolean))];

  return await db.transaction(async (tx) => {
    // 1) shift_uploads
    const [uploadRow] = await tx
      .insert(shiftUploads)
      .values({
        uploadedBy,
        weekStart: parsed.weekStart,
        weekEnd: parsed.weekEnd,
        rawContent,
        originalFilename,
        fileBytes,
        publishedAt: new Date(),
      })
      .returning({ id: shiftUploads.id });

    const uploadId = uploadRow.id;

    // 2) Upsert students
    let upsertedStudentCount = 0;
    if (studentNames.length > 0) {
      const ins = await tx
        .insert(students)
        .values(
          studentNames.map((n) => ({ name: n, nameKey: n })),
        )
        .onConflictDoNothing({ target: students.nameKey })
        .returning({ id: students.id });
      upsertedStudentCount = ins.length;
    }
    const studentRows = studentNames.length
      ? await tx
          .select({ id: students.id, nameKey: students.nameKey })
          .from(students)
          .where(inArray(students.nameKey, studentNames))
      : [];
    const studentIdByName = new Map(studentRows.map((s) => [s.nameKey, s.id]));

    // 3) Delete any existing weekly_shifts in this week range (cascades to assignments)
    await tx
      .delete(weeklyShifts)
      .where(
        and(
          gte(weeklyShifts.date, parsed.weekStart),
          lte(weeklyShifts.date, parsed.weekEnd),
        ),
      );

    // 4) Insert new weekly_shifts + shift_assignments
    let insertedShiftRows = 0;
    let insertedAssignmentRows = 0;

    for (const day of parsed.days) {
      if (day.isHoliday) continue;
      for (const slot of day.slots) {
        for (const a of slot.assignments) {
          const tutorId = mappings[a.teacherName];
          if (!tutorId) continue; // validated above, but be defensive

          const [shiftRow] = await tx
            .insert(weeklyShifts)
            .values({
              uploadId,
              tutorId,
              date: day.date,
              slotNumber: slot.slotNumber,
              seatNumber: a.seatNumber,
            })
            .returning({ id: weeklyShifts.id });

          insertedShiftRows++;

          if (a.students.length > 0) {
            const rows = a.students
              .slice(0, 2)
              .map((s, idx) => {
                const sid = studentIdByName.get(s.name.trim());
                if (!sid) return null;
                return {
                  weeklyShiftId: shiftRow.id,
                  studentId: sid,
                  subject: s.subject,
                  position: (idx + 1) as 1 | 2,
                };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null);
            if (rows.length > 0) {
              await tx.insert(shiftAssignments).values(rows);
              insertedAssignmentRows += rows.length;
            }
          }
        }
      }
    }

    return {
      uploadId,
      insertedShiftRows,
      insertedAssignmentRows,
      upsertedStudents: upsertedStudentCount,
      replacedDateCount: parsed.days.filter((d) => !d.isHoliday).length,
    };
  });
}

/**
 * Fetch active tutors for mapping dropdown.
 */
export async function fetchActiveTutors() {
  const { profiles } = await import("@/db/schema");
  return await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      email: profiles.email,
    })
    .from(profiles)
    .where(and(arrayContains(profiles.roles, ["tutor"]), eq(profiles.isActive, true)))
    .orderBy(profiles.displayName);
}
