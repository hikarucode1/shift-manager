import "server-only";
import { and, arrayContains, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  profiles,
  shiftAssignments,
  shiftUploads,
  students,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import type { ParsedShiftCsv } from "@/lib/shift-csv-parser";
import { findMappingDuplicates } from "@/lib/mapping-validation";
import { findNonTutorIds } from "@/lib/tutor-validation";
import { substitutionNote } from "@/lib/substitution-note";

export type TeacherMapping = Record<string, string>; // teacherName → profileId

/**
 * コミット時のユーザー向け業務エラー (対応付け未完了・重複・無効な講師など)。
 * #165: DB の生エラーと区別し、これだけ UI に文言を返す (呼び出し側で判定)。
 */
export class UploadCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadCommitError";
  }
}

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
  /** 取り込みで消えた承認済み代講のうち、付け替えを復元できた件数 (#210) */
  reappliedSwaps: number;
  /**
   * 復元できなかった承認済み代講 (#210)。新しい CSV で元の講師がそのコマに
   * 居ない = 基礎シフト自体が変わった場合。**握り潰さず呼び出し側に返す**。
   */
  unreappliedSwaps: { date: string; slotNumber: number }[];
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
    throw new UploadCommitError(
      `講師の対応付けが未完了です: ${missing.join(", ")}`,
    );
  }

  // 判定対象は CSV に実在する講師名のみに限定 (missing チェックと同じ正準ソース)。
  // クライアントが余分/古いキーを送っても誤検出しないようスコープを揃える。
  const scopedMappings: TeacherMapping = {};
  for (const name of parsed.uniqueTeacherNames) {
    scopedMappings[name] = mappings[name];
  }

  // #165: 割当先 ID の形式検証。改竄クライアントが非 uuid を送ると後続の
  // profiles クエリが "invalid input syntax for type uuid" で不透明に落ちるため、
  // 先に明確な業務エラーにする (pure・DB 到達前)。
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (parsed.uniqueTeacherNames.some((n) => !UUID_RE.test(scopedMappings[n]))) {
    throw new UploadCommitError("講師の割り当てが不正です。");
  }

  // 同一アカウントへの重複割当を拒否 (DB の unique 制約に当たる前に明示エラー)
  const dups = findMappingDuplicates(scopedMappings);
  if (dups.length > 0) {
    const detail = dups
      .map((d) => `「${d.csvNames.join("」「")}」`)
      .join(", ");
    throw new UploadCommitError(
      `同じ講師アカウントに複数の CSV 名が割り当てられています: ${detail}。1 名につき 1 アカウントにしてください。`,
    );
  }

  // CSV 内で同じ講師が同じ日・同じコマに 2 回以上現れるケースを検出
  // (座席を2つ持つ等)。mapping 重複とは別系統だが weekly_shifts_unique
  // (upload_id, tutor_id, date, slot_number) 違反になるため事前に弾く。
  const seen = new Set<string>();
  const collisions: string[] = [];
  let totalAssignments = 0;
  for (const day of parsed.days) {
    if (day.isHoliday) continue;
    for (const slot of day.slots) {
      for (const a of slot.assignments) {
        totalAssignments++;
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
    throw new UploadCommitError(
      `同じ講師が同じ日・同じコマに重複しています: ${uniq.join(" / ")}。CSV を確認してください。`,
    );
  }

  // #165: 出勤データが 1 件も無い CSV は、置換のため週の公開済みシフトを削除する
  // 一方で何も挿入せず、無言でその週を全消去してしまう (truncated / 破損ファイル)。
  // 明示エラーにしてデータ消失を防ぐ (全休講週は公開対象が無いので上げない想定)。
  if (totalAssignments === 0) {
    throw new UploadCommitError(
      "CSV に出勤データ (講師の割り当て) が見つかりません。ファイルが正しいか確認してください。",
    );
  }

  // #165: 割当先が「講師ロールを持つアカウント」か検証する (findNonTutorIds に集約)。
  // FK だけでは admin 専用アカウント等にコマが割り当たりうるため tutor ロール必須。
  // is_active を課さない判断の根拠は findNonTutorIds のコメント参照。
  const nonTutorIds = new Set(
    await findNonTutorIds(Object.values(scopedMappings)),
  );
  const invalidNames = parsed.uniqueTeacherNames.filter((n) =>
    nonTutorIds.has(scopedMappings[n]),
  );
  if (invalidNames.length > 0) {
    throw new UploadCommitError(
      `割り当て先が講師アカウントではありません: ${invalidNames.join(", ")}`,
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

    // 3) Delete existing weekly_shifts for the dates this CSV actually covers
    //    (cascades to assignments). #165: 以前は [weekStart, weekEnd] 全域を消して
    //    いたため、truncated CSV で day-block が欠落した日の公開済みシフトまで
    //    巻き添え削除された。CSV に含まれる日付だけを置換対象にする。
    const uploadedDates = [...new Set(parsed.days.map((d) => d.date))];
    if (uploadedDates.length > 0) {
      await tx.delete(weeklyShifts).where(inArray(weeklyShifts.date, uploadedDates));
    }

    // 4) Insert new weekly_shifts + shift_assignments
    let insertedShiftRows = 0;
    let insertedAssignmentRows = 0;

    for (const day of parsed.days) {
      if (day.isHoliday) continue;
      for (const slot of day.slots) {
        for (const a of slot.assignments) {
          // #165: 検証済みの scopedMappings を使う (生の mappings は検証を迂回する)
          const tutorId = scopedMappings[a.teacherName];
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

    // 5) #210: 承認済み代講の付け替えを復元する。
    //
    // 上の delete→insert は CSV を正として基礎シフトを作り直すが、それだけだと
    // **承認済みの代講が黙って巻き戻る** (tutor_id が元に戻り、is_override と
    // `代講(承認済): A → B` の note が消える)。しかも swap_requests は approved の
    // まま残るので、申請履歴と座席表が食い違ったままになる。
    //
    // 「誰が実際にそのコマに入ったか」は承認でしか記録できない (#178) ので、
    // CSV で基礎を作り直したうえに、その事実を積み直す。
    const approved =
      uploadedDates.length > 0
        ? await tx
            .select({
              requesterId: swapRequests.requesterId,
              applicantId: swapRequests.approvedApplicantId,
              date: swapRequests.date,
              slotNumber: swapRequests.slotNumber,
            })
            .from(swapRequests)
            .where(
              and(
                eq(swapRequests.status, "approved"),
                inArray(swapRequests.date, uploadedDates),
              ),
            )
        : [];

    let reappliedSwaps = 0;
    const unreappliedSwaps: { date: string; slotNumber: number }[] = [];

    for (const sw of approved) {
      if (!sw.applicantId) continue;

      const names = await tx
        .select({ id: profiles.id, name: profiles.displayName })
        .from(profiles)
        .where(inArray(profiles.id, [sw.requesterId, sw.applicantId]));
      const nameOf = (id: string) =>
        names.find((n) => n.id === id)?.name ?? "不明";

      const moved = await tx
        .update(weeklyShifts)
        .set({
          tutorId: sw.applicantId,
          isOverride: true,
          note: substitutionNote(nameOf(sw.requesterId), nameOf(sw.applicantId)),
        })
        .where(
          and(
            eq(weeklyShifts.tutorId, sw.requesterId),
            eq(weeklyShifts.date, sw.date),
            eq(weeklyShifts.slotNumber, sw.slotNumber),
          ),
        )
        .returning({ id: weeklyShifts.id });

      if (moved.length > 0) {
        reappliedSwaps += moved.length;
      } else {
        // 新しい CSV で元の講師がそのコマに居ない = 基礎シフト自体が変わった。
        // 付け替え先が無いので復元できない。**黙って捨てず呼び出し側に返す**。
        unreappliedSwaps.push({ date: sw.date, slotNumber: sw.slotNumber });
      }
    }

    return {
      uploadId,
      insertedShiftRows,
      insertedAssignmentRows,
      upsertedStudents: upsertedStudentCount,
      replacedDateCount: parsed.days.filter((d) => !d.isHoliday).length,
      reappliedSwaps,
      unreappliedSwaps,
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
