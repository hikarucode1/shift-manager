import { z } from "zod";

/**
 * 固定シフト登録の「担当したい生徒（任意）」(#319)。
 * 教室のレギュラーエクセルの「講師希望記入欄（生徒名 / 教科）」をアプリに移したもの。
 * 提出単位 (fixed_shift_submissions.preferred_students, jsonb) に配列で持つ。
 */
export type PreferredStudent = { student: string; subject: string };

export const MAX_PREFERRED_STUDENTS = 10;
export const MAX_STUDENT_NAME = 50;
export const MAX_SUBJECT = 30;

/** server action が受け取る形。trim 前の入力なので、空の行もここでは通す */
export const PreferredStudentsInputSchema = z
  .array(
    z.object({
      student: z.string().max(MAX_STUDENT_NAME),
      subject: z.string().max(MAX_SUBJECT),
    }),
  )
  .max(MAX_PREFERRED_STUDENTS);

/**
 * 保存する形に揃える。前後の空白を落とし、生徒名も教科も空の行は捨てる。
 * どちらか片方だけの行は残す (「数学なら誰でも」「○○さんなら何でも」がある)
 */
export function normalizePreferredStudents(
  rows: readonly PreferredStudent[],
): PreferredStudent[] {
  return rows
    .map((r) => ({ student: r.student.trim(), subject: r.subject.trim() }))
    .filter((r) => r.student !== "" || r.subject !== "");
}

const StoredSchema = z.array(
  z.object({ student: z.string(), subject: z.string() }),
);

/**
 * DB の jsonb を読む。形が崩れていたら (手で直した等) 空として扱い、
 * 画面を落とさない
 */
export function parseStoredPreferredStudents(value: unknown): PreferredStudent[] {
  const parsed = StoredSchema.safeParse(value);
  return parsed.success ? normalizePreferredStudents(parsed.data) : [];
}

/** 一覧で 1 行に並べる表示 (例: 「山田（数学）、佐藤、英語」) */
export function formatPreferredStudents(rows: readonly PreferredStudent[]): string {
  return rows
    .map((r) =>
      r.student && r.subject
        ? `${r.student}（${r.subject}）`
        : r.student || r.subject,
    )
    .join("、");
}
